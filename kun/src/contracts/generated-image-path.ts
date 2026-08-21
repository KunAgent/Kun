/** Canonical workspace directory for images created by Kun. */
export const KUN_GENERATED_IMAGE_DIR = '.kun/images'

/** Accepted only for compatibility with pre-Kun canvas export receipts. */
export const CANVAS_GENERATED_IMAGE_FILE_PATTERN =
  /^(?:\.kun\/images|\.deepseekgui-images)\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:png|svg)$/i
