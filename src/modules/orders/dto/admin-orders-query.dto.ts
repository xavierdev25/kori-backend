import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { OrderStatus } from '@prisma/client';

export class AdminOrdersQueryDto {
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
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** Desde (inclusive). Acepta "2026-08-01" o un ISO completo. */
  @IsOptional()
  @IsISO8601()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  from?: string;

  /**
   * Hasta (inclusive). Si viene solo la fecha, se toma hasta el final de ese
   * día: un filtro "hasta el 8" que excluyera las ventas del propio día 8
   * sería una trampa silenciosa.
   */
  @IsOptional()
  @IsISO8601()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  to?: string;
}
