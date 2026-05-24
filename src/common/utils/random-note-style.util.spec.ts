import { NOTE_COLORS } from '../constants/note.constants';
import {
  randomPositionX,
  randomPositionY,
  randomRotation,
  randomTextNoteColor,
  randomZIndex,
} from './random-note-style.util';

describe('random-note-style.util', () => {
  it('generates rotation between -15 and 25', () => {
    for (let index = 0; index < 500; index += 1) {
      const rotation = randomRotation();

      expect(rotation).toBeGreaterThanOrEqual(-15);
      expect(rotation).toBeLessThanOrEqual(25);
    }
  });

  it('generates positionX and positionY between 0 and 90', () => {
    for (let index = 0; index < 500; index += 1) {
      const positionX = randomPositionX();
      const positionY = randomPositionY();

      expect(positionX).toBeGreaterThanOrEqual(0);
      expect(positionX).toBeLessThanOrEqual(90);
      expect(positionY).toBeGreaterThanOrEqual(0);
      expect(positionY).toBeLessThanOrEqual(90);
    }
  });

  it('generates zIndex between 1 and 999', () => {
    for (let index = 0; index < 500; index += 1) {
      const zIndex = randomZIndex();

      expect(zIndex).toBeGreaterThanOrEqual(1);
      expect(zIndex).toBeLessThanOrEqual(999);
    }
  });

  it('generates an allowed text note color', () => {
    for (let index = 0; index < 500; index += 1) {
      expect(NOTE_COLORS).toContain(randomTextNoteColor());
    }
  });
});
