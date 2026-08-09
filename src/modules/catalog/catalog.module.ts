import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { CatalogService } from './catalog.service';
import { ProductDigitalAssetService } from './digital-asset.service';
import { ProductImagesService } from './product-images.service';
import { PublicCatalogController } from './public-catalog.controller';
import { PublicCatalogService } from './public-catalog.service';

@Module({
  imports: [PrismaModule, StorageModule, AuthModule],
  controllers: [PublicCatalogController, AdminCatalogController],
  providers: [
    CatalogService,
    ProductDigitalAssetService,
    ProductImagesService,
    PublicCatalogService,
  ],
  // El checkout (fase 5) recalculará precios con PublicCatalogService.
  exports: [CatalogService, PublicCatalogService],
})
export class CatalogModule {}
