import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prismaService: PrismaService) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'kori-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('liveness')
  getLiveness() {
    return {
      status: 'ok',
      service: 'kori-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  async getReadiness() {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }

    return {
      status: 'ok',
      service: 'kori-backend',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
        storage: 'startup-validated',
      },
    };
  }
}
