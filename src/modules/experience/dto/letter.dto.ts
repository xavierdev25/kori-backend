import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Length, Matches } from 'class-validator';

import { sanitizePlainText } from '../../../common/utils/text-sanitize.util';

/**
 * El "para" de una carta: un nombre o apodo, dos palabras como máximo, sin
 * números ni @ (que no se pueda señalar a nadie con nombre y apellido).
 * Mismo patrón que `NOMBRE_CARTA` en el frontend.
 */
export const NOMBRE_CARTA = /^[\p{L}][\p{L}'’-]*( [\p{L}][\p{L}'’-]*)?$/u;

const limpiarPara = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? sanitizePlainText(value).replace(/\s+/g, ' ').trim()
    : value;

/** El texto como texto plano; se respetan los saltos de línea. */
const limpiarTexto = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? sanitizePlainText(value)
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : value;

export class CreateLetterDto {
  @Transform(limpiarPara)
  @Length(1, 20)
  @Matches(NOMBRE_CARTA, {
    message: 'to: solo nombre o apodo, sin apellidos, números ni @',
  })
  to!: string;

  @Transform(limpiarTexto)
  @Length(2, 1000)
  text!: string;

  @IsOptional()
  @IsIn(['es', 'en'])
  locale?: 'es' | 'en';
}
