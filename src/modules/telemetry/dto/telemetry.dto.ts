import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Lo que el navegador puede mandar, y nada más.
 *
 * El `ValidationPipe` global va con `whitelist` y `forbidNonWhitelisted`, así
 * que cualquier campo que no esté aquí hace que la petición se rechace. Es un
 * endpoint público: lo que llegue es texto de un desconocido, y acaba en el
 * log, así que los límites de tamaño no son cosmética.
 */
export class TelemetryEventDto {
  @IsIn(['error', 'vital'])
  kind!: 'error' | 'vital';

  @IsString()
  @MaxLength(40)
  name!: string;

  /**
   * Milisegundos. El techo evita que un número absurdo ensucie una media.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600_000)
  value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsString()
  @MaxLength(120)
  page!: string;
}

export class TelemetryBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  // El cliente ya se limita a 20; aquí se vuelve a comprobar porque el
  // cliente lo escribe cualquiera.
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TelemetryEventDto)
  events!: TelemetryEventDto[];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  viewport?: string;
}
