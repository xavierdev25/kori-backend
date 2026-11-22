import { Module } from '@nestjs/common';

import { ExperienceSessionGuard } from './experience-session.guard';
import { ExperienceController } from './experience.controller';
import { ExperienceService } from './experience.service';
import { LettersService } from './letters.service';
import { ProgressService } from './progress.service';

@Module({
  controllers: [ExperienceController],
  providers: [
    ExperienceService,
    LettersService,
    ProgressService,
    ExperienceSessionGuard,
  ],
  exports: [LettersService],
})
export class ExperienceModule {}
