import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

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

export type StorageDriver = 'supabase' | 'local';

/** Carpeta de subida del driver local (servida como /uploads en main.ts). */
export const LOCAL_UPLOADS_DIR = 'uploads';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;
  private readonly supabase: ReturnType<typeof createClient> | null;
  private readonly bucket: string;
  private readonly localBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.driver =
      this.configService.get<string>('STORAGE_DRIVER') === 'local'
        ? 'local'
        : 'supabase';

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

  async onModuleInit(): Promise<void> {
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

      this.logger.log(
        `Supabase Storage connected successfully. Bucket "${this.bucket}" is available`,
      );
    } catch (error) {
      this.logger.error(this.getStorageErrorMessage(error));
      throw error;
    }
  }

  async uploadDrawing(file: Express.Multer.File): Promise<StoredFile> {
    const extension = this.getExtensionFromMimeType(
      file.mimetype as DrawingMimeType,
    );
    const storagePath = `drawings/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;

    if (this.driver === 'local') {
      return this.uploadDrawingToDisk(file, storagePath);
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

  private async uploadDrawingToDisk(
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
