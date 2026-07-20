import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Claves conocidas en app_settings. */
export const SETTING_KEYS = {
  countdownTarget: 'countdown_target',
  albumUrl: 'album_url',
} as const;

export interface PublicSettings {
  countdownTarget: string | null;
  albumUrl: string | null;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(): Promise<PublicSettings> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });

    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    return {
      countdownTarget: byKey.get(SETTING_KEYS.countdownTarget) ?? null,
      albumUrl: byKey.get(SETTING_KEYS.albumUrl) ?? null,
    };
  }

  async updateSettings(dto: UpdateSettingsDto): Promise<PublicSettings> {
    if (dto.countdownTarget !== undefined && dto.countdownTarget !== '') {
      if (Number.isNaN(Date.parse(dto.countdownTarget))) {
        throw new BadRequestException(
          'countdownTarget debe ser una fecha ISO 8601 válida',
        );
      }
    }

    if (dto.albumUrl !== undefined && dto.albumUrl !== '') {
      let parsed: URL;

      try {
        parsed = new URL(dto.albumUrl);
      } catch {
        throw new BadRequestException('albumUrl debe ser una URL válida');
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new BadRequestException('albumUrl debe ser http(s)');
      }
    }

    await this.prisma.$transaction([
      ...this.upsertOrDelete(SETTING_KEYS.countdownTarget, dto.countdownTarget),
      ...this.upsertOrDelete(SETTING_KEYS.albumUrl, dto.albumUrl),
    ]);

    return this.getSettings();
  }

  /** undefined = no tocar; '' = borrar; valor = upsert. */
  private upsertOrDelete(key: string, value: string | undefined) {
    if (value === undefined) {
      return [];
    }

    if (value === '') {
      return [this.prisma.appSetting.deleteMany({ where: { key } })];
    }

    return [
      this.prisma.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    ];
  }
}
