import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
