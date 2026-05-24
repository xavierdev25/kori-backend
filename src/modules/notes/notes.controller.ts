import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { memoryStorage } from 'multer';

import {
  ALLOWED_DRAWING_MIME_TYPES,
  MAX_DRAWING_FILE_SIZE_BYTES,
} from '../../common/constants/note.constants';
import { PublicNotesCacheInterceptor } from '../../common/interceptors/public-notes-cache.interceptor';
import { CreateDrawingNoteDto } from './dto/create-drawing-note.dto';
import { CreateTextNoteDto } from './dto/create-text-note.dto';
import { NotesService } from './notes.service';

@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post('text')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createTextNote(@Body() dto: CreateTextNoteDto, @Req() request: Request) {
    return this.notesService.createTextNote(dto, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Post('drawing')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_DRAWING_FILE_SIZE_BYTES,
        files: 1,
        fields: 5,
        fieldNameSize: 100,
        fieldSize: 1024,
        parts: 6,
      },
      fileFilter: (_request, file, callback) => {
        if (
          !(ALLOWED_DRAWING_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          callback(
            new BadRequestException('Tipo de imagen no permitido'),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  createDrawingNote(
    @Body() dto: CreateDrawingNoteDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
  ) {
    return this.notesService.createDrawingNote(dto, file, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Get('public')
  @UseInterceptors(PublicNotesCacheInterceptor)
  findPublicNotes(
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ) {
    return this.notesService.findPublicNotes(limit);
  }
}
