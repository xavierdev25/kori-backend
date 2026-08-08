import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { FulfillmentType, ProductType } from '@prisma/client';

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'El slug solo admite minúsculas, números y guiones simples',
  })
  @MaxLength(120)
  @Transform(trim)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  description?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'El slug solo admite minúsculas, números y guiones simples',
  })
  @MaxLength(120)
  @Transform(trim)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  description?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  isActive?: boolean;
}

export class AdminProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  search?: string;
}

export class CreateVariantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(trim)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  color?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(trim)
  sku!: string;

  /**
   * En centavos y entero: nunca un decimal. El tope de 10 millones (100 000
   * MXN) es una red contra el cero de más al capturar.
   */
  @Type(() => Number)
  @IsInt({ message: 'El precio debe ser un entero en centavos' })
  @Min(1)
  @Max(10_000_000)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  providerProductUid?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  @Transform(trim)
  printFileUrl?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(trim)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  color?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(trim)
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El precio debe ser un entero en centavos' })
  @Min(1)
  @Max(10_000_000)
  priceCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  providerProductUid?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  @Transform(trim)
  printFileUrl?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}
