-- Verify existing data is compatible with new constraints before adding them.
-- If any row violates invariants, the migration will abort safely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM notes
    WHERE type = 'TEXT'
      AND (message IS NULL OR color IS NULL OR image_url IS NOT NULL OR storage_path IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Existing TEXT notes violate type invariants. Cannot apply migration.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM notes
    WHERE type = 'DRAWING'
      AND (message IS NOT NULL OR color IS NOT NULL OR image_url IS NULL OR storage_path IS NULL)
  ) THEN
    RAISE EXCEPTION 'Existing DRAWING notes violate type invariants. Cannot apply migration.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM notes
    WHERE LENGTH(TRIM(recipient_name)) = 0
  ) THEN
    RAISE EXCEPTION 'Existing notes have empty recipient_name. Cannot apply migration.';
  END IF;
END
$$;

-- NOTE type field invariants
ALTER TABLE notes ADD CONSTRAINT chk_text_note_fields CHECK (
  (type = 'TEXT'    AND message IS NOT NULL AND color IS NOT NULL    AND image_url IS NULL     AND storage_path IS NULL)
  OR
  (type = 'DRAWING' AND message IS NULL     AND color IS NULL        AND image_url IS NOT NULL AND storage_path IS NOT NULL)
);

-- Positional and style constraints
ALTER TABLE notes ADD CONSTRAINT chk_rotation    CHECK (rotation   >= -15 AND rotation   <= 25);
ALTER TABLE notes ADD CONSTRAINT chk_position_x  CHECK (position_x >=   0 AND position_x <= 90);
ALTER TABLE notes ADD CONSTRAINT chk_position_y  CHECK (position_y >=   0 AND position_y <= 90);
ALTER TABLE notes ADD CONSTRAINT chk_z_index     CHECK (z_index    >=   1 AND z_index    <= 999);

-- Prevent empty recipient_name
ALTER TABLE notes ADD CONSTRAINT chk_recipient_name_not_empty CHECK (LENGTH(TRIM(recipient_name)) > 0);
