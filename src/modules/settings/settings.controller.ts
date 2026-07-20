import { Controller, Get, Header } from '@nestjs/common';

import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('public')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  getPublicSettings() {
    return this.settingsService.getSettings();
  }
}
