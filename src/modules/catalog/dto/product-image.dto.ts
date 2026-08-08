import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { MAX_IMAGES_PER_PRODUCT } from '../../../common/constants/product.constants';

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Campos de texto que acompañan al archivo en el multipart. */
export class UploadProductImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  altText?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  isPrimary?: boolean;
}

export class UpdateProductImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  altText?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  isPrimary?: boolean;
}

/**
 * Reordenar en una sola llamada: el panel manda los ids en el orden final tras
 * arrastrar. Hacerlo imagen por imagen dejaría estados intermedios raros si
 * una petición falla a media lista.
 */
export class ReorderProductImagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMAGES_PER_PRODUCT)
  @IsUUID('4', { each: true })
  imageIds!: string[];
}
