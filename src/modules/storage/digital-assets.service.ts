import { Readable } from 'stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

import { CircuitBreaker } from '../../common/resilience/circuit-breaker';

/**
 * El almacén de los archivos que se venden: drumkits, presets, lo que venga.
 *
 * Separado de `StorageService` a propósito. Aquel guarda imágenes públicas de
 * notas y productos en Supabase; este guarda producto de pago en un bucket
 * privado del que solo se sale por un enlace firmado que caduca. Mezclarlos
 * acabaría con alguien sirviendo un drumkit desde una URL pública.
 *
 * Habla S3 genérico y no la API propia de ningún proveedor. Hoy apunta a
 * Backblaze B2; si mañana funciona Cloudflare R2, o cualquier otro, se cambian
 * las variables de entorno y no se toca una línea de código.
 *
 * Es opcional al arrancar, igual que Stripe y Resend: sin credenciales el
 * backend levanta y avisa, y solo falla lo que de verdad necesita el bucket.
 */

/** Lo que se acepta subir. Un ejecutable en la tienda no tiene explicación. */
const ALLOWED_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
];

/** 500 MB. Muy por encima de lo que pesa un drumkit, y aun así un techo. */
const MAX_BYTES = 500 * 1024 * 1024;

/**
 * Cuánto vive la URL firmada que se entrega al navegador.
 *
 * Corta a propósito: es el último salto, el que ocurre cuando alguien ya
 * pulsó su enlace de descarga y se validó su permiso. Lo que caduca en 72
 * horas es el enlace del correo, no esto.
 */
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Los cuatro primeros bytes de un ZIP: "PK\x03\x04".
 *
 * Se comprueban porque el `mimetype` lo manda el navegador y no significa
 * nada: basta cambiarlo en la petición. Y no se puede quitar
 * `application/octet-stream` de la lista de permitidos, porque es lo que
 * mandan varios sistemas para un .zip legítimo. Mirar los bytes sí distingue.
 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Deja un nombre que pueda viajar en una cabecera HTTP.
 *
 * `productName` lo escribe quien administra, y acaba dentro de un
 * `Content-Disposition`. Sin esto, un nombre con salto de línea podría
 * inyectar cabeceras en la respuesta del almacén, y uno con acentos —
 * "Otoño", nada rebuscado en una tienda mexicana — rompe la cabecera, que
 * solo admite ASCII.
 */
export function sanitizeFilename(raw: string): string {
  const limpio = raw
    // Descompone los acentos y se queda con la letra base: "Otoño" → "Otono".
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Fuera saltos de línea, comillas, barras y cualquier cosa no imprimible.
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\/\r\n;]/g, '')
    .trim();

  return limpio.slice(0, 100) || 'descarga.zip';
}

export interface StoredAsset {
  bytes: number;
  path: string;
}

@Injectable()
export class DigitalAssetsService implements OnModuleInit {
  private readonly logger = new Logger(DigitalAssetsService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  /**
   * Un drumkit de 80 MB tarda; el umbral es alto a propósito para no abrir
   * el circuito por una subida lenta. Lo que se quiere cortar es el
   * almacenamiento caído, no el archivo grande.
   */
  private readonly breaker = new CircuitBreaker('el almacén de archivos', {
    failureThreshold: 4,
    resetMs: 30_000,
  });

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'S3_SECRET_ACCESS_KEY',
    );
    this.bucket = this.configService.get<string>('S3_BUCKET') ?? '';

    if (!endpoint || !accessKeyId || !secretAccessKey || !this.bucket) {
      this.client = null;
      return;
    }

    this.client = new S3Client({
      credentials: { accessKeyId, secretAccessKey },
      endpoint,
      // B2 y R2 solo entienden rutas del tipo `endpoint/bucket/clave`. Sin
      // esto el SDK usa el estilo de AWS (`bucket.endpoint/clave`) y falla.
      forcePathStyle: true,
      region: this.configService.get<string>('S3_REGION') ?? 'auto',
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        'S3_* sin definir: la venta de productos digitales responderá 503. El resto del backend funciona.',
      );
      return;
    }

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Almacén de archivos conectado. Bucket "${this.bucket}"`);
    } catch (error) {
      // Se avisa y se sigue. Que el almacén esté caído no puede impedir que
      // arranque el backend entero: los pedidos y el webhook de Stripe no
      // tienen nada que ver con esto.
      this.logger.error(
        `No se pudo conectar con el bucket "${this.bucket}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Sube el archivo de una variante y devuelve su ruta interna.
   *
   * El nombre se genera aquí y no se toma del archivo: un nombre de usuario
   * puede traer rutas relativas, y además el nombre original no aporta nada
   * cuando lo que importa es a qué variante pertenece.
   */
  async upload(
    variantId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<StoredAsset> {
    const client = this.requireClient();

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Formato no permitido. Sube el kit comprimido en .zip',
      );
    }

    // El `mimetype` lo dice el cliente; los bytes no mienten.
    if (!file.buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
      throw new BadRequestException(
        'El archivo no es un .zip. Comprime el kit antes de subirlo.',
      );
    }

    if (file.buffer.byteLength > MAX_BYTES) {
      throw new BadRequestException(
        `El archivo pesa más de ${MAX_BYTES / 1024 / 1024} MB`,
      );
    }

    const path = `variants/${variantId}/${randomUUID()}.zip`;

    await this.breaker.run(() =>
      client.send(
        new PutObjectCommand({
          Body: file.buffer,
          Bucket: this.bucket,
          ContentType: 'application/zip',
          Key: path,
        }),
      ),
    );

    return { bytes: file.buffer.byteLength, path };
  }

  /**
   * Una URL temporal para descargar. Solo debe llamarse después de haber
   * validado el permiso de quien la pide.
   */
  async getSignedUrl(path: string, filename: string): Promise<string> {
    const client = this.requireClient();

    return this.breaker.run(() =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: path,
          // Fuerza la descarga con un nombre legible en vez del UUID.
          ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"`,
        }),
        { expiresIn: SIGNED_URL_TTL_SECONDS },
      ),
    );
  }

  /** Lee el archivo. Solo para el caso en que se sirva a través del backend. */
  async getStream(path: string): Promise<Readable> {
    const client = this.requireClient();
    const result = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: path }),
    );

    return result.Body as Readable;
  }

  async remove(path: string): Promise<void> {
    const client = this.requireClient();

    await client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: path }),
    );
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El almacén de archivos no está configurado',
      );
    }

    return this.client;
  }
}
