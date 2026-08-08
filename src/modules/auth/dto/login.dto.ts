import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * La identidad pasó de `ADMIN_USERNAME` en variables de entorno a la tabla
 * `users`, y ahora el identificador es el correo.
 *
 * Se sigue aceptando el campo `username` porque el panel en producción todavía
 * lo envía: el backend se despliega antes que el dashboard y no puede romperle
 * el login mientras tanto. Se elimina cuando el panel esté actualizado.
 */
/** Los correos se guardan en minúsculas: el identificador no distingue caja. */
const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @IsOptional()
  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  @MaxLength(255)
  @Transform(normalizeEmail)
  email?: string;

  /** @deprecated Alias heredado de `email`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(normalizeEmail)
  username?: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(128)
  password!: string;
}
