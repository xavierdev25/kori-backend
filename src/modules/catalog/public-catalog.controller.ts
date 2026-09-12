import { Controller, Get, Param, UseInterceptors } from '@nestjs/common';

import { PublicCacheInterceptor } from '../../common/interceptors/public-cache.interceptor';
import { ProductSlugParamDto } from './dto/product-slug.dto';
import { PublicCatalogService } from './public-catalog.service';

/**
 * Catálogo público que consume la landing de Astro. Sin autenticación.
 *
 * Se cachea 5 minutos: el catálogo cambia como mucho unas pocas veces al mes,
 * y cada respuesta servida desde caché es una consulta menos a la base de
 * datos justo en la página por la que entra todo el mundo.
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
