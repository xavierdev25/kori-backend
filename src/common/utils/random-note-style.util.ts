import {
  NOTE_COLORS,
  RANDOM_POSITION_MAX,
  RANDOM_POSITION_MIN,
  RANDOM_ROTATION_MAX,
  RANDOM_ROTATION_MIN,
  RANDOM_Z_INDEX_MAX,
  RANDOM_Z_INDEX_MIN,
  type NoteColor,
} from '../constants/note.constants';

export interface RandomBaseNoteStyle {
  rotation: number;
  positionX: number;
  positionY: number;
  zIndex: number;
}

export interface RandomTextNoteStyle extends RandomBaseNoteStyle {
  color: NoteColor;
}

export function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomRotation(): number {
  return randomIntInclusive(RANDOM_ROTATION_MIN, RANDOM_ROTATION_MAX);
}

export function randomPositionX(): number {
  return randomIntInclusive(RANDOM_POSITION_MIN, RANDOM_POSITION_MAX);
}

export function randomPositionY(): number {
  return randomIntInclusive(RANDOM_POSITION_MIN, RANDOM_POSITION_MAX);
}

export function randomZIndex(): number {
  return randomIntInclusive(RANDOM_Z_INDEX_MIN, RANDOM_Z_INDEX_MAX);
}

export function randomTextNoteColor(): NoteColor {
  return NOTE_COLORS[randomIntInclusive(0, NOTE_COLORS.length - 1)];
}

export function randomBaseNoteStyle(): RandomBaseNoteStyle {
  return {
    rotation: randomRotation(),
    positionX: randomPositionX(),
    positionY: randomPositionY(),
    zIndex: randomZIndex(),
  };
}

export function randomTextNoteStyle(): RandomTextNoteStyle {
  return {
    ...randomBaseNoteStyle(),
    color: randomTextNoteColor(),
  };
}
