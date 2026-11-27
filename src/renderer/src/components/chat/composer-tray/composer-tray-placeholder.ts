import type { TrayKindId } from './tray-kind'

type Translate = (key: string, values?: unknown) => string

const SHEET_PLACEHOLDER_KEYS: Partial<Record<TrayKindId, string>> = {
  todo: 'composerTray.sheetPlaceholder.todo',
  workers: 'composerTray.sheetPlaceholder.workers',
  goal: 'composerTray.sheetPlaceholder.goal',
  graph: 'composerTray.sheetPlaceholder.graph',
  shells: 'composerTray.sheetPlaceholder.shells'
}

/**
 * Context-aware composer placeholder when a tray sheet is open above the
 * input or when Worker / Todo reference chips are attached in the composer.
 * Yields to higher-priority states (busy queue, offline, goal draft, quotes).
 */
export function resolveComposerTrayPlaceholder(input: {
  canEditComposer: boolean
  busy: boolean
  runtimeReady: boolean
  goalInputMode: boolean
  goalPanelOpen: boolean
  route: string
  hasTrayReference: boolean
  openTrayKind?: TrayKindId | null
  t: Translate
}): string | null {
  if (
    !input.canEditComposer ||
    !input.runtimeReady ||
    input.busy ||
    input.goalInputMode ||
    input.goalPanelOpen ||
    (input.route !== 'chat' && input.route !== 'ade')
  ) {
    return null
  }
  if (input.hasTrayReference) {
    return input.t('composerTray.referencePlaceholder')
  }
  const sheetKey = input.openTrayKind ? SHEET_PLACEHOLDER_KEYS[input.openTrayKind] : undefined
  return sheetKey ? input.t(sheetKey) : null
}
