import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { PublicCacheInterceptor } from '../../common/interceptors/public-cache.interceptor';
import { CreateLetterDto } from './dto/letter.dto';
import { LettersStatusDto } from './dto/letters-status.dto';
import { MemoryDto, PathDto, RunDto } from './dto/progress.dto';
import { RegisterExperienceDto } from './dto/register.dto';
import {
  ExperienceSessionGuard,
  type RequestConSesion,
} from './experience-session.guard';
import { ExperienceService } from './experience.service';
import { LettersService } from './letters.service';
import { ProgressService } from './progress.service';

/**
 * La experiencia del caballo (la portada): registro, cartas públicas y el
 * progreso del juego "Aún aquí".
 */
@Controller('experience')
export class ExperienceController {
  constructor(
    private readonly experience: ExperienceService,
    private readonly letters: LettersService,
    private readonly progress: ProgressService,
  ) {}

  /** Cinco por minuto y por IP, como "la señal". */
  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(NoCacheInterceptor)
  register(@Body() dto: RegisterExperienceDto, @Req() request: Request) {
    return this.experience.register(dto, request.ip);
  }

  /** Una carta pública (anónima, queda en revisión). Con sesión, contra abusos. */
  @Post('letters')
  @HttpCode(201)
  @UseGuards(ExperienceSessionGuard)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  createLetter(@Body() dto: CreateLetterDto) {
    return this.letters.create(dto);
  }

  /** El archivo público. Un minuto de caché: una aprobada tarda eso en salir. */
  @Get('letters')
  @UseInterceptors(new PublicCacheInterceptor(60, 120))
  approvedLetters() {
    return this.letters.approved();
  }

  @Post('letters/status')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(NoCacheInterceptor)
  lettersStatus(@Body() dto: LettersStatusDto) {
    return this.letters.status(dto.ids);
  }

  @Get('progress')
  @UseGuards(ExperienceSessionGuard)
  @UseInterceptors(NoCacheInterceptor)
  getProgress(@Req() request: RequestConSesion) {
    return this.progress.get(request.experienceSignupId!);
  }

  /** El juego guarda cada 100 m y al tomar algo: holgado para jugar, corto para un script. */
  @Post('progress/run')
  @HttpCode(200)
  @UseGuards(ExperienceSessionGuard)
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @UseInterceptors(NoCacheInterceptor)
  run(@Body() dto: RunDto, @Req() request: RequestConSesion) {
    return this.progress.run(request.experienceSignupId!, dto);
  }

  @Post('progress/path')
  @HttpCode(200)
  @UseGuards(ExperienceSessionGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(NoCacheInterceptor)
  path(@Body() dto: PathDto, @Req() request: RequestConSesion) {
    return this.progress.path(request.experienceSignupId!, dto.capitulos);
  }

  @Post('progress/memory')
  @HttpCode(200)
  @UseGuards(ExperienceSessionGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(NoCacheInterceptor)
  memory(@Body() dto: MemoryDto, @Req() request: RequestConSesion) {
    return this.progress.memory(request.experienceSignupId!, dto.recuerdo);
  }
}
