import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DigitalAssetsService } from './digital-assets.service';
import { StorageService } from './storage.service';

/**
 * Dos almacenes distintos a propósito:
 *
 *   · StorageService       — imágenes públicas (notas, fotos de producto)
 *   · DigitalAssetsService — producto de pago, en bucket privado y firmado
 *
 * Comparten módulo pero no implementación: lo que se vende no puede acabar
 * nunca en un bucket de lectura pública por un descuido de configuración.
 */
@Module({
  exports: [DigitalAssetsService, StorageService],
  imports: [ConfigModule],
  providers: [DigitalAssetsService, StorageService],
})
export class StorageModule {}
