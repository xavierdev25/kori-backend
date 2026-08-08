import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Moneda base de la tienda. La landing no debe deducirla ni fijarla a mano. */
export const STORE_CURRENCY = 'MXN';

/**
 * Proyección pública del catálogo.
 *
 * Se usa `select` y no `include` a propósito: así los campos sensibles no se
 * filtran por olvido, sino que hay que añadirlos explícitamente para que
 * salgan. Fuera quedan, y deben seguir fuera:
 *
 *   · providerProductUid — identificador del proveedor, información de negocio
 *   · printFileUrl     — el archivo de impresión, o sea el diseño original
 *   · storagePath      — ruta interna del bucket
 *   · isActive, sortOrder, timestamps — ruido interno
 */
const PUBLIC_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  type: true,
  images: {
    select: { url: true, altText: true, isPrimary: true },
    orderBy: { sortOrder: 'asc' },
  },
  variants: {
    where: { isActive: true },
    select: {
      id: true,
      label: true,
      size: true,
      color: true,
      sku: true,
      priceCents: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.ProductSelect;

/**
 * Solo se enseña lo que se puede comprar: producto publicado y con al menos
 * una variante activa. Un producto sin variantes activas no tiene precio ni
 * talla que ofrecer, así que no debe aparecer en la tienda.
 */
const PURCHASABLE: Prisma.ProductWhereInput = {
  isActive: true,
  variants: { some: { isActive: true } },
};

@Injectable()
export class PublicCatalogService {
  constructor(private readonly prismaService: PrismaService) {}

  async findAll() {
    const products = await this.prismaService.product.findMany({
      where: PURCHASABLE,
      select: PUBLIC_PRODUCT_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return { currency: STORE_CURRENCY, products };
  }

  async findBySlug(slug: string) {
    const product = await this.prismaService.product.findFirst({
      // Se filtra igual que en el listado: un producto despublicado responde
      // 404 aunque se conozca su slug.
      where: { slug, ...PURCHASABLE },
      select: PUBLIC_PRODUCT_SELECT,
    });

    if (!product) {
      throw new NotFoundException('El producto no existe');
    }

    return { currency: STORE_CURRENCY, product };
  }
}
