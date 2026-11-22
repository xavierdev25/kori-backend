import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { CAPITULOS, RECUERDOS, TOPES } from '../aunaqui.rules';

/**
 * Lo que trae una carrera de "Aún aquí". Los topes de aquí rechazan lo que
 * es imposible; `sumar` (aunaqui.rules.ts) además filtra ids y topa estrellas.
 */
export class RunDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(TOPES.estrellasPorEnvio)
  estrellas?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(TOPES.metrosPorCarrera)
  metros?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(TOPES.recorridosPorEnvio)
  recorridos?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TOPES.idsPorEnvio)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  paginas?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TOPES.idsPorEnvio)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  encuentros?: string[];
}

export class PathDto {
  @IsInt()
  @Min(0)
  @Max(CAPITULOS)
  capitulos!: number;
}

export class MemoryDto {
  @IsIn(RECUERDOS)
  recuerdo!: string;
}
