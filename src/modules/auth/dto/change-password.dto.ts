import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta la contraseña actual' })
  currentPassword!: string;

  /**
   * Mínimo 12 caracteres y ningún requisito de "una mayúscula y un símbolo".
   *
   * Las reglas de composición empujan a `Password1!` — corta, predecible y
   * apuntada en un papel. La longitud es lo que de verdad cuesta romper, y
   * una frase de cuatro palabras se recuerda sin apuntarla.
   *
   * El tope de 72 no es estético: bcrypt ignora todo lo que pase de 72 bytes,
   * así que sin él alguien podría creer que tiene una contraseña de 200
   * caracteres cuando en realidad solo cuentan los primeros 72.
   */
  @IsString()
  @MinLength(12, {
    message: 'La contraseña nueva necesita al menos 12 caracteres',
  })
  @MaxLength(72, {
    message: 'La contraseña nueva no puede pasar de 72 caracteres',
  })
  newPassword!: string;
}
