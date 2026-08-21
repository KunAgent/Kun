/** Canonical workspace directory for images created by Kun. */
export const KUN_GENERATED_IMAGE_DIR = '.kun/images'

/** Read-only compatibility for images created before the Kun rename. */
export const LEGACY_GENERATED_IMAGE_DIR = '.deepseekgui-images'

export const GENERATED_IMAGE_DIRS = [
  KUN_GENERATED_IMAGE_DIR,
  LEGACY_GENERATED_IMAGE_DIR
] as const

export const WORKSPACE_GENERATED_IMAGE_FILE_PATTERN =
  /^(?:\.kun\/images|\.deepseekgui-images)\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:png|svg)$/i

export function isWorkspaceGeneratedImagePath(path: string): boolean {
  const normalized = path.trim().replaceAll('\\', '/')
  return GENERATED_IMAGE_DIRS.some((directory) => normalized.startsWith(`${directory}/`))
}
