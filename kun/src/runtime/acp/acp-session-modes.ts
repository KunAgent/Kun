import type { AcpConfigOption, AcpSessionModes } from './acp-schema.js'

export type AcpModeEntry = { id: string; name?: string; description?: string }

/**
 * The agent's own mode selector. Older ACP agents report `modes`; newer ones
 * (OpenCode 1.18+) report the same list only as the `mode` config option.
 */
export type AcpModeSelector =
  | { source: 'modes'; currentModeId: string; availableModes: AcpModeEntry[] }
  | { source: 'config-option'; configId: string; currentModeId: string; availableModes: AcpModeEntry[] }

/** Legacy `modes` keeps precedence so agents that report both behave as before. */
export function acpSessionModeSelector(session: {
  modes?: AcpSessionModes | null
  configOptions?: readonly AcpConfigOption[] | null
}): AcpModeSelector | undefined {
  if (session.modes?.availableModes.length) {
    return { source: 'modes', currentModeId: session.modes.currentModeId, availableModes: session.modes.availableModes }
  }
  const option = session.configOptions?.find((entry) => entry.category === 'mode' && entry.type === 'select')
  if (!option || option.type !== 'select') return undefined
  const availableModes: AcpModeEntry[] = []
  const add = (raw: unknown): void => {
    const entry = raw as { value?: unknown; name?: unknown; description?: unknown }
    if (typeof entry.value !== 'string' || availableModes.some((mode) => mode.id === entry.value)) return
    availableModes.push({ id: entry.value,
      ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}) })
  }
  for (const entry of option.options) {
    const group = (entry as { options?: unknown }).options
    if (Array.isArray(group)) group.forEach(add)
    else add(entry)
  }
  return availableModes.length
    ? { source: 'config-option', configId: option.id, currentModeId: option.currentValue, availableModes }
    : undefined
}
