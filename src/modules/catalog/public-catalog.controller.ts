import { Controller, Get, Param, UseInterceptors } from '@nestjs/common';

import { PublicCacheInterceptor } from '../../common/interceptors/public-cache.interceptor';
import { ProductSlugParamDto } from './dto/product-slug.dto';
import { PublicCatalogService } from './public-catalog.service';

/**
 * Catálogo público que consume la landing de Astro. Sin autenticación.
 *
 * Se cachea 5 minutos: el catálogo cambia como mucho unas pocas veces al mes,
 * y cada respuesta servida desde caché es un arranque en frío de Render que el
 * comprador no sufre.
 */
@Controller('products')
@UseInterceptors(new PublicCacheInterceptor(300, 600))
export class PublicCatalogController {
  constructor(private readonly publicCatalogService: PublicCatalogService) {}

  @Get()
  findAll() {
    return this.publicCatalogService.findAll();
  }

  @Get(':slug')
  findBySlug(@Param() params: ProductSlugParamDto) {
    return this.publicCatalogService.findBySlug(params.slug);
  }
}
