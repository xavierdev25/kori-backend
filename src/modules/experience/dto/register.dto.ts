import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';

import { sanitizePlainText } from '../../../common/utils/text-sanitize.util';

const normalizarCorreo = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Texto plano, sin espacios de más (se limpia ANTES de validar). */
const limpiar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? sanitizePlainText(value).replace(/\s+/g, ' ').trim()
    : value;

const mayusculas = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * El registro de la experiencia del caballo: correo, ubicación y la
 * confirmación de edad. Mismas reglas que la tabla (`signal_signups_*_check`).
 */
export class RegisterExperienceDto {
  @Transform(normalizarCorreo)
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  /** ISO 3166-1 alfa-2. */
  @Transform(mayusculas)
  @Matches(/^[A-Z]{2}$/, { message: 'country debe ser un código de país' })
  country!: string;

  @Transform(limpiar)
  @IsNotEmpty({ message: 'region no puede estar vacío' })
  @MaxLength(60)
  @Matches(/\p{L}/u, { message: 'region debe contener letras' })
  region!: string;

  @Transform(limpiar)
  @IsNotEmpty({ message: 'city no puede estar vacío' })
  @MaxLength(60)
  @Matches(/\p{L}/u, { message: 'city debe contener letras' })
  city!: string;

  @IsOptional()
  @IsIn(['es', 'en'])
  locale?: 'es' | 'en';

  /** 18 años o más, o permiso de su mamá, papá o tutor. Sin esto no hay fila. */
  @Equals(true, { message: 'ageConfirmed debe ser true' })
  ageConfirmed!: true;

  /** Fecha del aviso de privacidad aceptado (`PRIVACIDAD_ACTUALIZADA`). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'privacyVersion debe tener el formato AAAA-MM-DD',
  })
  privacyVersion!: string;
}
