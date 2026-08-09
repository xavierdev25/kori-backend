import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { DigitalAssetsService } from '../storage/digital-assets.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El archivo que se vende, visto desde el panel.
 *
 * Subir y quitar el drumkit de una variante. Es el equivalente digital del
 * `printFileUrl` de las prendas: sin él, el producto no se puede publicar y
 * el checkout se niega a cobrarlo.
 */
@Injectable()
export class ProductDigitalAssetService {
  private readonly logger = new Logger(ProductDigitalAssetService.name);

  constructor(
    private readonly digitalAssets: DigitalAssetsService,
    private readonly prismaService: PrismaService,
  ) {}

  async upload(
    productId: string,
    variantId: string,
    file: Express.Multer.File,
  ) {
    const variant = await this.findVariant(productId, variantId);

    if (variant.product.fulfillmentType !== 'DIGITAL') {
      throw new ConflictException(
        'Solo los productos digitales llevan archivo de descarga',
      );
    }

    const anterior = variant.digitalAssetPath;
    const stored = await this.digitalAssets.upload(variantId, file);

    const actualizada = await this.prismaService.productVariant.update({
      data: {
        digitalAssetBytes: stored.bytes,
        digitalAssetPath: stored.path,
      },
      select: {
        digitalAssetBytes: true,
        digitalAssetPath: true,
        id: true,
        label: true,
      },
      where: { id: variantId },
    });

    // El anterior se borra DESPUÉS de apuntar el nuevo. Si se hiciera antes y
    // fallara la subida, la variante se quedaría sin archivo y sin vuelta
    // atrás. Y si el borrado falla, solo queda basura en el bucket: molesta,
    // pero no rompe nada.
    if (anterior && anterior !== stored.path) {
      await this.removeQuietly(anterior);
    }

    return actualizada;
  }

  async remove(productId: string, variantId: string) {
    const variant = await this.findVariant(productId, variantId);

    if (variant.product.isActive) {
      // Quitarle el archivo a algo que está a la venta deja el producto
      // cobrable pero no entregable. Se despublica primero.
      throw new ConflictException(
        'Despublica el producto antes de quitar su archivo',
      );
    }

    if (!variant.digitalAssetPath) {
      return { digitalAssetPath: null, id: variantId };
    }

    await this.removeQuietly(variant.digitalAssetPath);

    return this.prismaService.productVariant.update({
      data: { digitalAssetBytes: null, digitalAssetPath: null },
      select: { digitalAssetBytes: true, digitalAssetPath: true, id: true },
      where: { id: variantId },
    });
  }

  private async findVariant(productId: string, variantId: string) {
    const variant = await this.prismaService.productVariant.findFirst({
      include: { product: true },
      where: { id: variantId, productId },
    });

    if (!variant) {
      throw new NotFoundException('La variante no existe en este producto');
    }

    return variant;
  }

  /**
   * Un archivo huérfano en el bucket cuesta céntimos; una excepción aquí
   * deja al usuario con un error después de que la operación ya funcionó.
   */
  private async removeQuietly(path: string): Promise<void> {
    try {
      await this.digitalAssets.remove(path);
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar "${path}" del bucket: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
