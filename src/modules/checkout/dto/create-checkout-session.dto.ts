import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
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

  /** Solo para prerrellenar el campo en Stripe. No se usa para nada más. */
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;
}
