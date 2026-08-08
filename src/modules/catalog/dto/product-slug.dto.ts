import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * El slug viene de la URL, así que se valida con el mismo formato que exige la
 * base de datos: cualquier cosa que no encaje se rechaza con 400 antes de
 * llegar a consultar.
 */
export class ProductSlugParamDto {
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'Slug no válido',
  })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  slug!: string;
}
