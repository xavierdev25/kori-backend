import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const ESTADOS_CARTA = ['pending', 'approved', 'rejected'] as const;
export type EstadoCarta = (typeof ESTADOS_CARTA)[number];

export class AdminLettersQueryDto {
  @IsOptional()
  @IsIn(ESTADOS_CARTA)
  status?: EstadoCarta;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ReviewLetterDto {
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';
}
