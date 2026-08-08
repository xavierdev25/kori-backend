import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import {
  ALLOWED_PRODUCT_IMAGE_MIME_TYPES,
  MAX_PRODUCT_IMAGE_SIZE_BYTES,
} from '../../common/constants/product.constants';
import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CatalogService } from './catalog.service';
import {
  ReorderProductImagesDto,
  UpdateProductImageDto,
  UploadProductImageDto,
} from './dto/product-image.dto';
import {
  AdminProductsQueryDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';
import { ProductImagesService } from './product-images.service';

/**
 * El catálogo lo gestionan tanto ARTIST como ADMIN: el artista sube su merch.
 * Las ventas, en cambio, son solo de ADMIN (fase 9).
 */
@Controller('admin/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ARTIST', 'ADMIN')
@UseInterceptors(NoCacheInterceptor)
export class AdminCatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly productImagesService: ProductImagesService,
  ) {}

  // ── Productos ────────────────────────────────────────────────────

  @Get()
  findProducts(@Query() query: AdminProductsQueryDto) {
    return this.catalogService.findProducts(query);
  }

  @Get(':id')
  findProductById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.findProductById(id);
  }

  @Post()
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalogService.createProduct(dto);
  }

  @Patch(':id')
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(id, dto);
  }

  /** Devuelve 409 si el producto ya tiene ventas: entonces se desactiva. */
  @Delete(':id')
  deleteProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.deleteProduct(id);
  }

  // ── Variantes ────────────────────────────────────────────────────

  @Post(':id/variants')
  createVariant(
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.catalogService.createVariant(productId, dto);
  }

  @Patch(':id/variants/:variantId')
  updateVariant(
    @Param('id', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.catalogService.updateVariant(productId, variantId, dto);
  }

  @Delete(':id/variants/:variantId')
  deleteVariant(
    @Param('id', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.catalogService.deleteVariant(productId, variantId);
  }

  // ── Imágenes ─────────────────────────────────────────────────────

  @Get(':id/images')
  listImages(@Param('id', ParseUUIDPipe) productId: string) {
    return this.productImagesService.listImages(productId);
  }

  @Post(':id/images')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_PRODUCT_IMAGE_SIZE_BYTES,
        files: 1,
        fields: 5,
        fieldNameSize: 100,
        fieldSize: 1024,
        parts: 6,
      },
      fileFilter: (_request, file, callback) => {
        if (
          !(ALLOWED_PRODUCT_IMAGE_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          callback(
            new BadRequestException(
              `Formato no permitido. Usa: ${ALLOWED_PRODUCT_IMAGE_MIME_TYPES.join(', ')}`,
            ),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  uploadImage(
    @Param('id', ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadProductImageDto,
  ) {
    if (!file) {
      throw new BadRequestException('Falta el archivo de imagen');
    }

    return this.productImagesService.uploadImage(productId, file, dto);
  }

  /** Lista completa de ids en el orden final tras arrastrar en el panel. */
  @Patch(':id/images/order')
  reorderImages(
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: ReorderProductImagesDto,
  ) {
    return this.productImagesService.reorderImages(productId, dto);
  }

  @Patch(':id/images/:imageId')
  updateImage(
    @Param('id', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateProductImageDto,
  ) {
    return this.productImagesService.updateImage(productId, imageId, dto);
  }

  @Delete(':id/images/:imageId')
  deleteImage(
    @Param('id', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productImagesService.deleteImage(productId, imageId);
  }
}
