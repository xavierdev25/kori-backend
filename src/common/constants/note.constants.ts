export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export const MAX_RECIPIENT_NAME_LENGTH = 40;
export const MAX_MESSAGE_LENGTH = 256;

export const MAX_DRAWING_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export const ALLOWED_DRAWING_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type DrawingMimeType = (typeof ALLOWED_DRAWING_MIME_TYPES)[number];

export const RANDOM_ROTATION_MIN = -15;
export const RANDOM_ROTATION_MAX = 25;
export const RANDOM_POSITION_MIN = 0;
export const RANDOM_POSITION_MAX = 90;
export const RANDOM_Z_INDEX_MIN = 1;
export const RANDOM_Z_INDEX_MAX = 999;

export const PUBLIC_NOTES_DEFAULT_LIMIT = 200;
export const PUBLIC_NOTES_MAX_LIMIT = 200;
export const ADMIN_NOTES_DEFAULT_PAGE = 1;
export const ADMIN_NOTES_DEFAULT_LIMIT = 20;
export const ADMIN_NOTES_MAX_LIMIT = 100;
