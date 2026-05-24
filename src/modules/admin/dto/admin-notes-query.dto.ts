import { NoteType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  ADMIN_NOTES_DEFAULT_LIMIT,
  ADMIN_NOTES_DEFAULT_PAGE,
  ADMIN_NOTES_MAX_LIMIT,
} from '../../../common/constants/note.constants';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminNotesQueryDto {
  @IsOptional()
  @IsEnum(NoteType)
  type?: NoteType;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = ADMIN_NOTES_DEFAULT_PAGE;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ADMIN_NOTES_MAX_LIMIT)
  limit = ADMIN_NOTES_DEFAULT_LIMIT;
}
