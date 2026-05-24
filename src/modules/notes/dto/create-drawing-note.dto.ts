import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { MAX_RECIPIENT_NAME_LENGTH } from '../../../common/constants/note.constants';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateDrawingNoteDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_RECIPIENT_NAME_LENGTH)
  recipientName!: string;
}
