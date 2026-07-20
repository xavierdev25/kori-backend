import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateSettingsDto {
  /** Fecha objetivo del contador (ISO 8601). Cadena vacía = borrar. */
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  countdownTarget?: string;

  /** Link del álbum para el botón al llegar a cero. Cadena vacía = borrar. */
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  albumUrl?: string;
}
