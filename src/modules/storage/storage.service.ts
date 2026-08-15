import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

import {
  ALLOWED_DRAWING_MIME_TYPES,
  type DrawingMimeType,
} from '../../common/constants/note.constants';

export interface StoredFile {
  imageUrl: string;
  storagePath: string;
}

/**
 * `s3` habla S3 genérico, no la API de ningún proveedor concreto: sirve para
 * Backblaze B2, Cloudflare R2 o el S3 de Amazon cambiando solo variables de
 * entorno. Es lo que permite salir de Supabase sin reescribir nada.
 */
export type StorageDriver = 'supabase' | 's3' | 'local';

/** Carpeta de subida del driver local (servida como /uploads en main.ts). */
export const LOCAL_UPLOADS_DIR = 'uploads';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;
  private readonly supabase: ReturnType<typeof createClient> | null;
  private readonly s3: S3Client | null = null;
  /** Prefijo público de las imágenes del driver s3. Sin barra final. */
  private readonly s3PublicBaseUrl: string = '';
  private readonly bucket: string;
  private readonly localBaseUrl: string;
  /** Se rellena al arrancar. Ver `isReachable`. */
  private reachable = false;

  constructor(private readonly configService: ConfigService) {
    this.driver = this.resolveDriver(
      this.configService.get<string>('STORAGE_DRIVER'),
    );

    if (this.driver === 's3') {
      this.supabase = null;
      this.localBaseUrl = '';
      this.bucket = this.configService.getOrThrow<string>('S3_PUBLIC_BUCKET');
      this.s3PublicBaseUrl = this.configService
        .getOrThrow<string>('S3_PUBLIC_BASE_URL')
        .replace(/\/+$/, '');

      // Las credenciales propias son opcionales y caen a las del bucket
      // privado si no están. Con un solo proveedor no hay que repetir nada;
      // con dos —los drumkits en Backblaze, que sale más barato para archivos
      // de 80 MB, y las imágenes en S3— cada uno lleva las suyas.
      const endpoint =
        this.configService.get<string>('S3_PUBLIC_ENDPOINT') ??
        this.configService.getOrThrow<string>('S3_ENDPOINT');

      // Este bucket es PÚBLICO y el de los drumkits es privado. Si alguien
      // apunta los dos al mismo sitio, cada kit de pago queda descargable
      // desde una URL sin firmar y sin que nada lo delate. Se para el
      // arranque antes que dejar pasar eso. Se comparan endpoint y bucket
      // juntos: el mismo nombre en dos proveedores distintos no es colisión.
      if (
        this.bucket === this.configService.get<string>('S3_BUCKET') &&
        endpoint === this.configService.get<string>('S3_ENDPOINT')
      ) {
        throw new Error(
          'S3_PUBLIC_BUCKET no puede ser el mismo bucket que S3_BUCKET: ' +
            'ese guarda los productos de pago y no puede ser público.',
        );
      }

      this.s3 = new S3Client({
        credentials: {
          accessKeyId:
            this.configService.get<string>('S3_PUBLIC_ACCESS_KEY_ID') ??
            this.configService.getOrThrow<string>('S3_ACCESS_KEY_ID'),
          secretAccessKey:
            this.configService.get<string>('S3_PUBLIC_SECRET_ACCESS_KEY') ??
            this.configService.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
        },
        endpoint,
        // B2 y R2 solo entienden `endpoint/bucket/clave`.
        forcePathStyle: true,
        region:
          this.configService.get<string>('S3_PUBLIC_REGION') ??
          this.configService.get<string>('S3_REGION') ??
          'auto',
      });

      return;
    }

    if (this.driver === 'local') {
      // Modo desarrollo: archivos en disco, sin dependencia de Supabase.
      const port = this.configService.get<string>('PORT') ?? '4000';
      this.localBaseUrl =
        this.configService.get<string>('PUBLIC_BASE_URL') ??
        `http://localhost:${port}`;
      this.supabase = null;
      this.bucket = LOCAL_UPLOADS_DIR;
      return;
    }

    this.localBaseUrl = '';
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    const bucket = this.configService.get<string>('SUPABASE_STORAGE_BUCKET');

    if (!supabaseUrl || !serviceRoleKey || !bucket) {
      const missingConfigKeys = [
        !supabaseUrl ? 'SUPABASE_URL' : undefined,
        !serviceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY' : undefined,
        !bucket ? 'SUPABASE_STORAGE_BUCKET' : undefined,
      ].filter((key): key is string => Boolean(key));

      throw new Error(
        `Supabase Storage configuration is missing: ${missingConfigKeys.join(', ')}`,
      );
    }

    this.bucket = bucket;
    this.supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  /** `supabase` sigue siendo el valor por defecto: nadie se migra sin querer. */
  private resolveDriver(raw: string | undefined): StorageDriver {
    if (raw === 'local' || raw === 's3') {
      return raw;
    }

    return 'supabase';
  }

  async onModuleInit(): Promise<void> {
    if (this.driver === 's3') {
      try {
        await this.getS3().send(new HeadBucketCommand({ Bucket: this.bucket }));
        this.reachable = true;
        this.logger.log(
          `Almacén de imágenes S3 conectado. Bucket "${this.bucket}"`,
        );
      } catch (error) {
        // Mismo criterio que abajo: se avisa y se sigue. Que no se pueda
        // subir una imagen no puede impedir que se cobre un pedido.
        this.reachable = false;
        this.logger.error(
          `No se pudo conectar con el bucket público "${this.bucket}": ${this.toMessage(
            error,
          )} — la aplicación arranca igual, pero subir imágenes responderá 503.`,
        );
      }
      return;
    }

    if (this.driver === 'local') {
      await mkdir(join(process.cwd(), LOCAL_UPLOADS_DIR, 'drawings'), {
        recursive: true,
      });
      this.logger.warn(
        `Storage driver "local" activo (solo desarrollo). Archivos en ./${LOCAL_UPLOADS_DIR}, servidos desde ${this.localBaseUrl}/uploads`,
      );
      return;
    }

    try {
      const { error } = await this.getSupabase().storage.getBucket(this.bucket);

      if (error) {
        throw new Error(error.message);
      }

      this.reachable = true;
      this.logger.log(
        `Supabase Storage connected successfully. Bucket "${this.bucket}" is available`,
      );
    } catch (error) {
      // Se avisa muy fuerte, pero NO se relanza.
      //
      // Antes esto tumbaba el arranque entero de la aplicación. Con Supabase
      // pausándose a los 7 días de inactividad y Render reiniciando el
      // contenedor tras 15 minutos sin tráfico, bastaba que coincidieran para
      // que la API no levantara: ni pedidos, ni webhook de Stripe, ni panel.
      // Todo caído por no poder subir una imagen.
      //
      // Lo que depende del almacén falla con un 503 claro; lo que no, sigue.
      this.reachable = false;
      this.logger.error(
        `${this.getStorageErrorMessage(error)} — la aplicación arranca igual, pero subir imágenes responderá 503 hasta que se restablezca.`,
      );
    }
  }

  /**
   * Si el almacén respondió al arrancar. Lo usa /health/readiness para
   * distinguir "sano" de "funcionando a medias".
   */
  get isReachable(): boolean {
    return this.driver === 'local' || this.reachable;
  }

  /** Dibujos del muro. Envoltorio sobre uploadImage por compatibilidad. */
  async uploadDrawing(file: Express.Multer.File): Promise<StoredFile> {
    return this.uploadImage(file, 'drawings');
  }

  /**
   * Sube una imagen a una carpeta del bucket. La usan tanto los dibujos del
   * muro como las fotos de producto del catálogo: mismos formatos, mismo
   * driver, misma gestión de errores.
   */
  async uploadImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<StoredFile> {
    const extension = this.getExtensionFromMimeType(
      file.mimetype as DrawingMimeType,
    );
    const storagePath = `${folder}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;

    if (this.driver === 'local') {
      return this.uploadToDisk(file, storagePath);
    }

    if (this.driver === 's3') {
      return this.uploadToS3(file, storagePath);
    }

    const { error } = await this.getSupabase()
      .storage.from(this.bucket)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      this.logger.error(
        `Supabase upload failed: ${this.sanitizeSensitiveValues(error.message)}`,
      );
      throw new InternalServerErrorException('No se pudo subir la imagen');
    }

    const { data } = this.getSupabase()
      .storage.from(this.bucket)
      .getPublicUrl(storagePath);

    if (!data.publicUrl) {
      throw new InternalServerErrorException(
        'No se pudo obtener la URL publica de la imagen',
      );
    }

    return {
      imageUrl: data.publicUrl,
      storagePath,
    };
  }

  async deleteFile(storagePath: string): Promise<void> {
    if (this.driver === 'local') {
      try {
        await unlink(join(process.cwd(), LOCAL_UPLOADS_DIR, storagePath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.error(`Local delete failed: ${this.toMessage(error)}`);
          throw new InternalServerErrorException(
            'No se pudo borrar la imagen asociada',
          );
        }
      }
      return;
    }

    if (this.driver === 's3') {
      try {
        await this.getS3().send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: storagePath }),
        );
      } catch (error) {
        this.logger.error(`Borrado en S3 falló: ${this.toMessage(error)}`);
        throw new InternalServerErrorException(
          'No se pudo borrar la imagen asociada',
        );
      }
      return;
    }

    const { error } = await this.getSupabase()
      .storage.from(this.bucket)
      .remove([storagePath]);

    if (error) {
      this.logger.error(
        `Supabase delete failed: ${this.sanitizeSensitiveValues(error.message)}`,
      );
      throw new InternalServerErrorException(
        'No se pudo borrar la imagen asociada',
      );
    }
  }

  private async uploadToDisk(
    file: Express.Multer.File,
    storagePath: string,
  ): Promise<StoredFile> {
    try {
      const absolutePath = join(process.cwd(), LOCAL_UPLOADS_DIR, storagePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.buffer);

      return {
        imageUrl: `${this.localBaseUrl}/uploads/${storagePath}`,
        storagePath,
      };
    } catch (error) {
      this.logger.error(`Local upload failed: ${this.toMessage(error)}`);
      throw new InternalServerErrorException('No se pudo subir la imagen');
    }
  }

  /**
   * Sube al bucket público.
   *
   * No se manda ACL a propósito: R2 no las admite y en B2 la visibilidad es
   * del bucket, no del objeto. Lo público lo decide el bucket, que además es
   * lo que se puede auditar de un vistazo en vez de objeto por objeto.
   */
  private async uploadToS3(
    file: Express.Multer.File,
    storagePath: string,
  ): Promise<StoredFile> {
    try {
      await this.getS3().send(
        new PutObjectCommand({
          Body: file.buffer,
          Bucket: this.bucket,
          // Un año e `immutable` porque la ruta lleva un UUID: este archivo
          // no se reescribe nunca, cambiar la imagen genera una ruta nueva.
          // Sin esto, CloudFront usa su valor por defecto (24 h) y vuelve a
          // pedirle a S3 algo que jamás cambia.
          CacheControl: 'public, max-age=31536000, immutable',
          // Sin esto el navegador se descarga la imagen en vez de mostrarla:
          // S3 sirve `application/octet-stream` cuando no se le dice nada.
          ContentType: file.mimetype,
          Key: storagePath,
        }),
      );

      return {
        imageUrl: `${this.s3PublicBaseUrl}/${storagePath}`,
        storagePath,
      };
    } catch (error) {
      this.logger.error(`Subida a S3 falló: ${this.toMessage(error)}`);
      throw new InternalServerErrorException('No se pudo subir la imagen');
    }
  }

  private getS3(): S3Client {
    if (!this.s3) {
      throw new InternalServerErrorException(
        'El almacén de imágenes S3 no está configurado',
      );
    }

    return this.s3;
  }

  private getSupabase(): ReturnType<typeof createClient> {
    if (!this.supabase) {
      throw new InternalServerErrorException(
        'Supabase client is not configured',
      );
    }

    return this.supabase;
  }

  private getExtensionFromMimeType(mimeType: DrawingMimeType): string {
    if (!ALLOWED_DRAWING_MIME_TYPES.includes(mimeType)) {
      throw new InternalServerErrorException('Tipo de imagen no soportado');
    }

    const extensions: Record<DrawingMimeType, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };

    return extensions[mimeType];
  }

  private getStorageErrorMessage(error: unknown): string {
    const sanitizedMessage = this.sanitizeSensitiveValues(
      this.toMessage(error),
    );

    if (/not found|404|does not exist/i.test(sanitizedMessage)) {
      return `Supabase Storage bucket "${this.bucket}" was not found. Verify SUPABASE_STORAGE_BUCKET. ${sanitizedMessage}`;
    }

    if (
      /invalid api key|invalid compact jws|jwt|jws|unauthorized|forbidden|401|403/i.test(
        sanitizedMessage,
      )
    ) {
      return `Supabase Storage authentication failed. Verify SUPABASE_SERVICE_ROLE_KEY value and permissions. ${sanitizedMessage}`;
    }

    return `Supabase Storage initialization failed for bucket "${this.bucket}". ${sanitizedMessage}`;
  }

  private toMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private sanitizeSensitiveValues(message: string): string {
    const sensitiveValues = [process.env.SUPABASE_SERVICE_ROLE_KEY].filter(
      (value): value is string => Boolean(value),
    );

    return sensitiveValues.reduce(
      (sanitizedMessage, sensitiveValue) =>
        sanitizedMessage.replaceAll(sensitiveValue, '[redacted]'),
      message,
    );
  }
}
