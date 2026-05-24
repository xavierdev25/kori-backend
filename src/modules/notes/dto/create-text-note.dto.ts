import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import {
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENT_NAME_LENGTH,
} from '../../../common/constants/note.constants';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTextNoteDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_RECIPIENT_NAME_LENGTH)
  recipientName!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  message!: string;
}
