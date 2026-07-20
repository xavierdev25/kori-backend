import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateSubscriberDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;
}
