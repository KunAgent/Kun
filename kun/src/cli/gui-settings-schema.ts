export const CURRENT_GUI_SETTINGS_SCHEMA_VERSION = 1

export class NewerGuiSettingsSchemaError extends Error {
  readonly code = 'gui_settings_schema_newer'
  readonly storedVersion: number
  readonly supportedVersion = CURRENT_GUI_SETTINGS_SCHEMA_VERSION

  constructor(storedVersion: number, sourcePath?: string) {
    super(
      `GUI settings schema version ${storedVersion} is newer than the supported version ` +
        `${CURRENT_GUI_SETTINGS_SCHEMA_VERSION}` +
        (sourcePath ? ` (${sourcePath})` : '')
    )
    this.name = 'NewerGuiSettingsSchemaError'
    this.storedVersion = storedVersion
  }
}

export function assertSupportedGuiSettingsVersion(value: unknown, sourcePath?: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const version = (value as Record<string, unknown>).version
  if (version === undefined) return
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid GUI settings schema version${sourcePath ? ` (${sourcePath})` : ''}`)
  }
  if (version > CURRENT_GUI_SETTINGS_SCHEMA_VERSION) {
    throw new NewerGuiSettingsSchemaError(version, sourcePath)
  }
}
