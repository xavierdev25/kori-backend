import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AdminLettersQueryDto,
  ReviewLetterDto,
} from '../experience/dto/admin-letters.dto';
import { LettersService } from '../experience/letters.service';

/** La moderación de las cartas públicas, desde el panel. */
@Controller('admin/experience/letters')
@UseGuards(JwtAuthGuard)
@UseInterceptors(NoCacheInterceptor)
export class AdminExperienceController {
  constructor(private readonly letters: LettersService) {}

  @Get()
  findLetters(@Query() query: AdminLettersQueryDto) {
    return this.letters.findAll(query.status, query.page, query.limit);
  }

  @Patch(':id')
  reviewLetter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewLetterDto,
  ) {
    return this.letters.review(id, dto.status);
  }

  @Delete(':id')
  deleteLetter(@Param('id', ParseUUIDPipe) id: string) {
    return this.letters.remove(id);
  }
}
