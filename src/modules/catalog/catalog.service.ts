import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  AdminProductsQueryDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';

/** Violación de restricción única en Prisma. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class CatalogService {
  constructor(private readonly prismaService: PrismaService) {}

  // ── Productos ────────────────────────────────────────────────────

  async findProducts(query: AdminProductsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ProductWhereInput = {
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prismaService.$transaction([
      this.prismaService.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          images: { orderBy: { sortOrder: 'asc' } },
          // Las variantes viajan en el listado (son 5 por producto) para que
          // el panel pueda enseñar el precio y si al producto le falta algo
          // para publicarse, sin pedir el detalle de cada fila.
          variants: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              label: true,
              priceCents: true,
              isActive: true,
              providerProductUid: true,
              printFileUrl: true,
            },
          },
          _count: { select: { variants: true } },
        },
      }),
      this.prismaService.product.count({ where }),
    ]);

    // Mismo envoltorio que /admin/notes, que ya está en producción: un panel
    // con dos formas de paginar es un error esperando a ocurrir.
    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findProductById(id: string) {
    const product = await this.prismaService.product.findUnique({
      where: { id },
      include: {
        variants: { orderBy: { sortOrder: 'asc' } },
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!product) {
      throw new NotFoundException('El producto no existe');
    }

    return product;
  }

  async createProduct(dto: CreateProductDto) {
    const { priceCents, ...producto } = dto;

    // Un producto digital lleva una sola variante y el panel no la enseña:
    // un drumkit no tiene tallas. Se crea aquí para que publicar no obligue a
    // inventarse una "talla única" a mano, que es lo que exigiría la
    // validación de publicación.
    const esDigital = producto.fulfillmentType === 'DIGITAL';

    if (esDigital && !priceCents) {
      throw new ConflictException(
        'Un producto digital necesita su precio al crearlo',
      );
    }

    try {
      return await this.prismaService.product.create({
        data: {
          ...producto,
          ...(esDigital && priceCents
            ? {
                variants: {
                  create: {
                    label: 'Descarga',
                    priceCents,
                    // El slug ya es único, así que sirve de SKU sin pedirle
                    // a nadie que se invente otro identificador.
                    sku: producto.slug.toUpperCase(),
                  },
                },
              }
            : {}),
        },
        include: { variants: true },
      });
    } catch (error) {
      this.rethrowUniqueViolation(error, {
        sku: `Ya existe una variante con el SKU "${producto.slug.toUpperCase()}"`,
        slug: `Ya existe un producto con el slug "${producto.slug}"`,
      });
      throw error;
    }
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.assertProductExists(id);

    // Publicar un producto que no se puede producir deja al comprador pagando
    // algo que el proveedor rechazará. Se valida aquí, no al crear la orden.
    if (dto.isActive === true) {
      await this.assertProductIsPublishable(id);
    }

    try {
      return await this.prismaService.product.update({
        where: { id },
        data: { ...dto },
      });
    } catch (error) {
      this.rethrowUniqueViolation(error, {
        slug: `Ya existe un producto con el slug "${dto.slug ?? ''}"`,
      });
      throw error;
    }
  }

  /**
   * Un producto con ventas no se borra: se desactiva. El historial se lee de
   * las copias congeladas de OrderItem, pero la variante sigue referenciada y
   * borrarla rompería la trazabilidad hacia el catálogo.
   */
  async deleteProduct(id: string) {
    await this.assertProductExists(id);

    const soldUnits = await this.prismaService.orderItem.count({
      where: { productVariant: { productId: id } },
    });

    if (soldUnits > 0) {
      throw new ConflictException(
        `Este producto tiene ${soldUnits} venta(s) registradas y no se puede borrar. Desactívalo con PATCH { "isActive": false }.`,
      );
    }

    await this.prismaService.product.delete({ where: { id } });

    return { deleted: true };
  }

  // ── Variantes ────────────────────────────────────────────────────

  async createVariant(productId: string, dto: CreateVariantDto) {
    await this.assertProductExists(productId);

    try {
      return await this.prismaService.productVariant.create({
        data: { ...dto, productId },
      });
    } catch (error) {
      this.rethrowUniqueViolation(error, {
        sku: `Ya existe una variante con el SKU "${dto.sku}"`,
        label: `Ya existe una variante llamada "${dto.label}" en este producto`,
        size: 'Ya existe una variante con esa combinación de talla y color',
      });
      throw error;
    }
  }

  async updateVariant(
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    await this.assertVariantBelongsToProduct(productId, variantId);

    try {
      return await this.prismaService.$transaction(async (tx) => {
        const updated = await tx.productVariant.update({
          where: { id: variantId },
          data: { ...dto },
        });

        // Publicar valida que el producto sea producible, pero después se
        // podía vaciar el providerProductUid de una variante y dejar el
        // producto activo e imposible de imprimir. Se valida el estado
        // resultante y, si no cuadra, la transacción revierte el cambio.
        await this.assertStillPublishable(productId, tx);

        return updated;
      });
    } catch (error) {
      this.rethrowUniqueViolation(error, {
        sku: `Ya existe una variante con el SKU "${dto.sku ?? ''}"`,
        label: 'Ya existe una variante con ese nombre en este producto',
        size: 'Ya existe una variante con esa combinación de talla y color',
      });
      throw error;
    }
  }

  async deleteVariant(productId: string, variantId: string) {
    await this.assertVariantBelongsToProduct(productId, variantId);

    const soldUnits = await this.prismaService.orderItem.count({
      where: { productVariantId: variantId },
    });

    if (soldUnits > 0) {
      throw new ConflictException(
        `Esta variante tiene ${soldUnits} venta(s) registradas y no se puede borrar. Desactívala con PATCH { "isActive": false }.`,
      );
    }

    await this.prismaService.$transaction(async (tx) => {
      await tx.productVariant.delete({ where: { id: variantId } });
      await this.assertStillPublishable(productId, tx);
    });

    return { deleted: true };
  }

  // ── Apoyo ────────────────────────────────────────────────────────

  private async assertProductExists(id: string): Promise<void> {
    const exists = await this.prismaService.product.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('El producto no existe');
    }
  }

  private async assertVariantBelongsToProduct(
    productId: string,
    variantId: string,
  ): Promise<void> {
    const variant = await this.prismaService.productVariant.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });

    // Mismo 404 si no existe o si es de otro producto: no se filtra la
    // existencia de recursos ajenos a través de la ruta.
    if (!variant || variant.productId !== productId) {
      throw new NotFoundException('La variante no existe en este producto');
    }
  }

  /**
   * Un producto ya publicado no puede quedar en un estado que no se pueda
   * producir. Sobre uno despublicado no se comprueba nada: ahí se está
   * trabajando y es normal que esté a medias.
   */
  private async assertStillPublishable(
    productId: string,
    client: Prisma.TransactionClient,
  ): Promise<void> {
    const product = await client.product.findUniqueOrThrow({
      where: { id: productId },
      select: { isActive: true },
    });

    if (product.isActive) {
      await this.assertProductIsPublishable(productId, client);
    }
  }

  /**
   * Un producto POD solo es publicable si toda variante activa tiene el UID del
   * proveedor y el archivo de impresión, y si hay al menos una imagen.
   */
  private async assertProductIsPublishable(
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prismaService,
  ): Promise<void> {
    const product = await client.product.findUniqueOrThrow({
      where: { id },
      include: {
        variants: { where: { isActive: true } },
        _count: { select: { images: true } },
      },
    });

    const problems: string[] = [];

    if (product.variants.length === 0) {
      problems.push('no tiene variantes activas');
    }

    if (product._count.images === 0) {
      problems.push('no tiene ninguna imagen');
    }

    if (product.fulfillmentType === 'POD') {
      const incomplete = product.variants.filter(
        (variant) => !variant.providerProductUid || !variant.printFileUrl,
      );

      if (incomplete.length > 0) {
        problems.push(
          `estas variantes no tienen providerProductUid o archivo de impresión: ${incomplete
            .map((variant) => variant.label)
            .join(', ')}`,
        );
      }
    }

    if (product.fulfillmentType === 'DIGITAL') {
      // El equivalente digital de no tener archivo de impresión: publicarlo
      // sería poner a la venta algo que nadie podría descargar.
      const sinArchivo = product.variants.filter(
        (variant) => !variant.digitalAssetPath,
      );

      if (sinArchivo.length > 0) {
        problems.push('todavía no tiene el archivo subido');
      }
    }

    if (problems.length > 0) {
      throw new ConflictException(
        `No se puede publicar el producto porque ${problems.join('; ')}.`,
      );
    }
  }

  /** Traduce el P2002 de Prisma a un 409 con un mensaje que sirva de algo. */
  private rethrowUniqueViolation(
    error: unknown,
    messagesByField: Record<string, string>,
  ): void {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== UNIQUE_VIOLATION
    ) {
      return;
    }

    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : [String(target)];
    const matched = fields
      .map((field) => messagesByField[field])
      .find((message): message is string => Boolean(message));

    throw new ConflictException(matched ?? 'Ese valor ya está en uso');
  }
}
