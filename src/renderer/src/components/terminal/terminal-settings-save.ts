import type { TerminalSettingsPatchV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { emitRendererSettingsChanged } from '../../lib/keyboard-shortcut-settings'

/** Save a terminal settings patch from the dock and broadcast the result. */
export function saveSettingsPatch(patch: TerminalSettingsPatchV1): void {
  void rendererRuntimeClient.setSettings({ terminal: patch })
    .then((settings) => emitRendererSettingsChanged(settings))
    .catch(() => undefined)
}
