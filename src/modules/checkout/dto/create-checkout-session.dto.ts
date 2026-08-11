import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CheckoutItemDto {
  @IsUUID('4')
  variantId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;
}

/**
 * Fíjate en lo que NO está aquí: ni precio, ni subtotal, ni total, ni coste de
 * envío. Todo eso se calcula en el servidor leyendo la base de datos. El
 * `ValidationPipe` global con `forbidNonWhitelisted` rechaza la petición si el
 * cliente intenta colar cualquiera de esos campos.
 */
export class CreateCheckoutSessionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  /**
   * Idioma del comprador, tal como lo declara su navegador ("es-MX", "en-GB").
   *
   * Se pide aquí y no se deduce de la IP: la IP falla con VPN, con datos
   * móviles y con quien viaja, mientras que esto es lo que la persona eligió.
   * Se normaliza en el servidor, así que da igual lo que llegue.
   */
  @IsOptional()
  @IsString()
  @MaxLength(35)
  locale?: string;

  /**
   * Si marcó la casilla de novedades.
   *
   * Va sin marcar por defecto y así llega: `undefined` es "no". Nadie acaba
   * en la lista por no haber mirado. El alta no ocurre aquí sino cuando el
   * pago se confirma, con el correo que Stripe verificó: apuntar a alguien
   * que abandonó el pago sería apuntar a quien nunca llegó a comprar.
   */
  @IsOptional()
  @IsBoolean()
  newsletter?: boolean;

  /** Solo para prerrellenar el campo en Stripe. No se usa para nada más. */
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;
}
