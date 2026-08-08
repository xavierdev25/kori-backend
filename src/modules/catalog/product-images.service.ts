import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  MAX_IMAGES_PER_PRODUCT,
  PRODUCT_IMAGE_FOLDER,
} from '../../common/constants/product.constants';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  ReorderProductImagesDto,
  UpdateProductImageDto,
  UploadProductImageDto,
} from './dto/product-image.dto';

@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async listImages(productId: string) {
    await this.assertProductExists(productId);

    return this.prismaService.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async uploadImage(
    productId: string,
    file: Express.Multer.File,
    dto: UploadProductImageDto,
  ) {
    await this.assertProductExists(productId);

    const existingCount = await this.prismaService.productImage.count({
      where: { productId },
    });

    if (existingCount >= MAX_IMAGES_PER_PRODUCT) {
      throw new BadRequestException(
        `Un producto admite como máximo ${MAX_IMAGES_PER_PRODUCT} imágenes`,
      );
    }

    // La primera imagen es la principal aunque no se pida: un producto sin
    // principal no se puede pintar en la landing.
    const shouldBePrimary = dto.isPrimary === true || existingCount === 0;

    const stored = await this.storageService.uploadImage(
      file,
      PRODUCT_IMAGE_FOLDER,
    );

    try {
      return await this.prismaService.$transaction(async (tx) => {
        if (shouldBePrimary) {
          // El índice único parcial solo admite una principal por producto:
          // hay que bajar la anterior en la misma transacción.
          await tx.productImage.updateMany({
            where: { productId, isPrimary: true },
            data: { isPrimary: false },
          });
        }

        return tx.productImage.create({
          data: {
            productId,
            url: stored.imageUrl,
            storagePath: stored.storagePath,
            altText: dto.altText,
            isPrimary: shouldBePrimary,
            sortOrder: existingCount,
          },
        });
      });
    } catch (error) {
      // Si la fila no se pudo escribir, el objeto en Supabase se queda
      // huérfano y nadie lo va a limpiar nunca. Mejor borrarlo aquí.
      await this.safeDeleteFile(stored.storagePath);
      throw error;
    }
  }

  async updateImage(
    productId: string,
    imageId: string,
    dto: UpdateProductImageDto,
  ) {
    await this.assertImageBelongsToProduct(productId, imageId);

    return this.prismaService.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await tx.productImage.updateMany({
          where: { productId, isPrimary: true, id: { not: imageId } },
          data: { isPrimary: false },
        });
      }

      return tx.productImage.update({
        where: { id: imageId },
        data: {
          ...(dto.altText === undefined ? {} : { altText: dto.altText }),
          ...(dto.isPrimary === undefined ? {} : { isPrimary: dto.isPrimary }),
        },
      });
    });
  }

  async reorderImages(productId: string, dto: ReorderProductImagesDto) {
    await this.assertProductExists(productId);

    const images = await this.prismaService.productImage.findMany({
      where: { productId },
      select: { id: true },
    });
    const knownIds = new Set(images.map((image) => image.id));

    // Se exige la lista completa: un reordenamiento parcial dejaría posiciones
    // duplicadas y un orden no determinista en la tienda.
    if (
      dto.imageIds.length !== images.length ||
      dto.imageIds.some((id) => !knownIds.has(id))
    ) {
      throw new BadRequestException(
        'La lista debe contener exactamente las imágenes de este producto',
      );
    }

    await this.prismaService.$transaction(
      dto.imageIds.map((id, index) =>
        this.prismaService.productImage.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );

    return this.listImages(productId);
  }

  async deleteImage(productId: string, imageId: string) {
    const image = await this.assertImageBelongsToProduct(productId, imageId);

    await this.prismaService.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });

      // Al borrar la principal, la siguiente por orden toma el relevo: si no,
      // el producto se queda sin imagen que enseñar.
      if (image.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { productId },
          orderBy: { sortOrder: 'asc' },
        });

        if (next) {
          await tx.productImage.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
        }
      }

      // Un producto publicado no puede quedarse sin ninguna imagen: la tienda
      // lo pintaría vacío. La transacción revierte el borrado.
      const product = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: { isActive: true },
      });

      if (product.isActive) {
        const remaining = await tx.productImage.count({ where: { productId } });

        if (remaining === 0) {
          throw new ConflictException(
            'No se puede borrar la última imagen de un producto publicado. Despublícalo primero.',
          );
        }
      }
    });

    if (image.storagePath) {
      await this.safeDeleteFile(image.storagePath);
    }

    return { deleted: true };
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('El producto no existe');
    }
  }

  private async assertImageBelongsToProduct(
    productId: string,
    imageId: string,
  ) {
    const image = await this.prismaService.productImage.findUnique({
      where: { id: imageId },
    });

    if (!image || image.productId !== productId) {
      throw new NotFoundException('La imagen no existe en este producto');
    }

    return image;
  }

  /**
   * Un objeto huérfano en Storage es un problema menor; tumbar la petición por
   * ello sería peor, sobre todo cuando la fila ya se borró correctamente.
   */
  private async safeDeleteFile(storagePath: string): Promise<void> {
    try {
      await this.storageService.deleteFile(storagePath);
    } catch (error) {
      this.logger.error(
        `No se pudo borrar el archivo huérfano "${storagePath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
