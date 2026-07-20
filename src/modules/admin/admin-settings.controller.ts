import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateSettingsDto } from '../settings/dto/update-settings.dto';
import { SettingsService } from '../settings/settings.service';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard)
@UseInterceptors(NoCacheInterceptor)
export class AdminSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Patch()
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }
}
