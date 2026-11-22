import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** ¿Cómo van mis cartas? Solo quien tiene el id (quien la mandó) pregunta. */
export class LettersStatusDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  ids!: string[];
}
