import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateContactMessageDto {
  @Transform(trim)
  @IsNotEmpty({ message: 'name no puede estar vacío' })
  @MaxLength(80)
  name!: string;

  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  /**
   * 2 000 caracteres es de sobra para contar un problema y poco para usar el
   * formulario como buzón de spam. El límite también está en la caja del
   * navegador, pero el que cuenta es este: lo de fuera no se cree.
   */
  @Transform(trim)
  @IsNotEmpty({ message: 'message no puede estar vacío' })
  @MaxLength(2_000)
  message!: string;

  /** En qué idioma escribió, para contestarle en el suyo. */
  @IsOptional()
  @IsIn(['es', 'en'])
  locale?: 'es' | 'en';
}
