import { BadRequestException, Injectable } from '@nestjs/common';

import {
  ALLOWED_DRAWING_MIME_TYPES,
  MAX_DRAWING_FILE_SIZE_BYTES,
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENT_NAME_LENGTH,
  PUBLIC_NOTES_DEFAULT_LIMIT,
  PUBLIC_NOTES_MAX_LIMIT,
} from '../../common/constants/note.constants';
import { sha256OrNull } from '../../common/utils/hash.util';
import {
  randomBaseNoteStyle,
  randomTextNoteStyle,
} from '../../common/utils/random-note-style.util';
import { sanitizePlainText } from '../../common/utils/text-sanitize.util';
import { StorageService } from '../storage/storage.service';
import { CreateDrawingNoteDto } from './dto/create-drawing-note.dto';
import { CreateTextNoteDto } from './dto/create-text-note.dto';
import { NotesRepository, PublicNoteRecord } from './notes.repository';

export interface RequestFingerprint {
  ip?: string;
  userAgent?: string;
}

interface FingerprintHashes {
  ipHash: string | null;
  userAgentHash: string | null;
}

@Injectable()
export class NotesService {
  constructor(
    private readonly notesRepository: NotesRepository,
    private readonly storageService: StorageService,
  ) {}

  async createTextNote(
    dto: CreateTextNoteDto,
    fingerprint: RequestFingerprint = {},
  ): Promise<PublicNoteRecord> {
    const recipientName = this.sanitizeRequiredText(
      dto.recipientName,
      'recipientName',
      MAX_RECIPIENT_NAME_LENGTH,
    );
    const message = this.sanitizeRequiredText(
      dto.message,
      'message',
      MAX_MESSAGE_LENGTH,
    );
    const style = randomTextNoteStyle();

    return this.notesRepository.createTextNote({
      recipientName,
      message,
      color: style.color,
      rotation: style.rotation,
      positionX: style.positionX,
      positionY: style.positionY,
      zIndex: style.zIndex,
      ...this.createFingerprintHashes(fingerprint),
    });
  }

  async createDrawingNote(
    dto: CreateDrawingNoteDto,
    file: Express.Multer.File | undefined,
    fingerprint: RequestFingerprint = {},
  ): Promise<PublicNoteRecord> {
    const recipientName = this.sanitizeRequiredText(
      dto.recipientName,
      'recipientName',
      MAX_RECIPIENT_NAME_LENGTH,
    );

    this.validateDrawingFile(file);

    const storedFile = await this.storageService.uploadDrawing(file);
    const style = randomBaseNoteStyle();

    return this.notesRepository.createDrawingNote({
      recipientName,
      imageUrl: storedFile.imageUrl,
      storagePath: storedFile.storagePath,
      rotation: style.rotation,
      positionX: style.positionX,
      positionY: style.positionY,
      zIndex: style.zIndex,
      ...this.createFingerprintHashes(fingerprint),
    });
  }

  async findPublicNotes(
    limit = PUBLIC_NOTES_DEFAULT_LIMIT,
  ): Promise<PublicNoteRecord[]> {
    const normalizedLimit = Number.isFinite(limit)
      ? Math.trunc(limit)
      : PUBLIC_NOTES_DEFAULT_LIMIT;
    const safeLimit = Math.min(
      Math.max(normalizedLimit, 1),
      PUBLIC_NOTES_MAX_LIMIT,
    );

    return this.notesRepository.findPublicNotes(safeLimit);
  }

  private sanitizeRequiredText(
    value: string,
    fieldName: string,
    maxLength: number,
  ): string {
    const sanitized = sanitizePlainText(value);

    if (!sanitized) {
      throw new BadRequestException(`${fieldName} no puede estar vacio`);
    }

    if (sanitized.length > maxLength) {
      throw new BadRequestException(
        `${fieldName} no puede exceder ${maxLength} caracteres`,
      );
    }

    return sanitized;
  }

  private createFingerprintHashes(
    fingerprint: RequestFingerprint,
  ): FingerprintHashes {
    return {
      ipHash: sha256OrNull(fingerprint.ip),
      userAgentHash: sha256OrNull(fingerprint.userAgent),
    };
  }

  private validateDrawingFile(
    file: Express.Multer.File | undefined,
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException('El archivo de dibujo es requerido');
    }

    if (file.size > MAX_DRAWING_FILE_SIZE_BYTES) {
      throw new BadRequestException('El archivo no puede superar 2 MB');
    }

    if (
      !(ALLOWED_DRAWING_MIME_TYPES as readonly string[]).includes(file.mimetype)
    ) {
      throw new BadRequestException('Tipo de imagen no permitido');
    }

    if (!this.hasValidImageSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        'El archivo no coincide con el tipo enviado',
      );
    }
  }

  private hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'image/png') {
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    }

    if (mimeType === 'image/jpeg') {
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );
    }

    if (mimeType === 'image/webp') {
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    }

    return false;
  }
}
