import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';

import { sanitizePlainText } from '../../../common/utils/text-sanitize.util';

/** Lo mismo que admite la tabla (`signal_signups_name_check`). */
export const SIGNAL_NAME_MAX_LENGTH = 60;

/**
 * El nombre tal y como se usará para saludar en el correo: texto plano, sin
 * espacios de más. Se limpia ANTES de validar, para que la longitud y la
 * comprobación de letras miren lo que de verdad se va a guardar.
 */
const cleanName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? sanitizePlainText(value).replace(/\s+/g, ' ').trim()
    : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Lo que manda la sección "la señal" de la portada.
 *
 * Los dos consentimientos son campos distintos porque son decisiones
 * distintas (la LFPDPPP pide poder negarse a las finalidades secundarias sin
 * perder las primarias): `consent` es el de la campaña y tiene que ser `true`
 * para que la fila exista; `marketingOptIn`, el de "lo que venga después", es
 * opcional y por defecto `false`.
 */
export class CreateSignalSignupDto {
  @Transform(cleanName)
  @IsNotEmpty({ message: 'name no puede estar vacío' })
  @MaxLength(SIGNAL_NAME_MAX_LENGTH)
  // Al menos una letra: "..." o "123" no son un nombre con el que saludar.
  @Matches(/\p{L}/u, { message: 'name debe contener al menos una letra' })
  name!: string;

  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsIn(['es', 'en'])
  locale?: 'es' | 'en';

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;

  /**
   * El consentimiento obligatorio, explícito. No se guarda como columna —una
   * fila solo existe si fue `true`—, pero exigirlo aquí impide que un cliente
   * que se lo salte acabe apuntando a alguien que no aceptó nada.
   */
  @Equals(true, { message: 'consent debe ser true' })
  consent!: true;

  /** Fecha del aviso de privacidad aceptado (`PRIVACIDAD_ACTUALIZADA`). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'privacyVersion debe tener el formato AAAA-MM-DD',
  })
  privacyVersion!: string;
}
