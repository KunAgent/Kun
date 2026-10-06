import { join } from 'node:path'
import { getJsoncValue } from './edit/jsonc.js'
import { getYamlValue } from './edit/yaml.js'
import type { GatewayModelInfo, WiringContext } from './types.js'

/** Shared helpers for agent adapters. */
export const v1 = (origin: string): string => `${origin.replace(/\/+$/, '')}/v1`
export const xdgConfig = (ctx: WiringContext): string => ctx.env.XDG_CONFIG_HOME?.trim() || join(ctx.home, '.config')

export function safeJson(read: (file: string) => string, file: string, path: string[]): unknown {
  try { return getJsoncValue(read(file), path) } catch { return undefined }
}

export function safeYaml(read: (file: string) => string, file: string, path: string[]): unknown {
  try { return getYamlValue(read(file), path) } catch { return undefined }
}

export function displayName(model: GatewayModelInfo): string {
  return model.displayName ?? model.id
}

/** Kun effort -> a scale that tops out at `xhigh` (Codex, Pi). */
export function xhighEffort(effort: string | undefined): string | undefined {
  if (!effort || effort === 'auto') return undefined
  return effort === 'max' ? 'xhigh' : effort
}
