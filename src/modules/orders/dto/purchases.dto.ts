import { Transform, Type } from 'class-transformer';
import { IsEmail, IsInt, MaxLength, Min } from 'class-validator';

export class RequestPurchaseAccessDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;
}

export class ResendDownloadsDto {
  /**
   * El número visible del pedido, no su id.
   *
   * Es lo que el comprador tiene delante en su correo y en la pantalla. Y da
   * igual que sea adivinable: el servicio comprueba además que el pedido sea
   * del mismo correo que el token, así que probar números no lleva a nada.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderNumber!: number;
}
