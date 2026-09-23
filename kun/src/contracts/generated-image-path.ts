/** Canonical workspace directory for images created by Kun. */
export const KUN_GENERATED_IMAGE_DIR = '.kun/images'

/** Strict path shape for an Excalidraw PNG sidecar under a whiteboard directory. */
export const EXCALIDRAW_PNG_SIDECAR_PATTERN =
  /^\.kun-whiteboards\/([A-Za-z0-9_-]{1,64})\/excalidraw\.png$/i

/** Accepted only for compatibility with pre-Kun canvas export receipts and Excalidraw PNG sidecars. */
export const CANVAS_GENERATED_IMAGE_FILE_PATTERN =
  /^(?:(?:\.kun\/images|\.deepseekgui-images)\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:png|svg)|\.kun-whiteboards\/[A-Za-z0-9_-]{1,64}\/excalidraw\.png)$/i
