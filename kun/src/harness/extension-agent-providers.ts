import { createHash } from 'node:crypto'
import type { AgentProviderDeclaration } from '@kun/extension-api'
import type { HarnessProviderOverride } from '../config/kun-config-harness-providers.js'

/**
 * A local ACP Agent declared by an installed, enabled extension that holds
 * the `agents.register` permission. It joins the catalog
 * like a user Agent; the user still enables it explicitly before any launch.
 */
export type ExtensionAgentProvider = {
  harnessId: string
  extensionId: string
  extensionName?: string
  override: HarnessProviderOverride
}

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Stable harness id (`ext-<publisher>-<name>-<id>`) within the 48-character id rule. */
export function extensionAgentHarnessId(extensionId: string, localId: string): string {
  const id = `ext-${slug(`${extensionId}-${localId}`)}`
  if (id.length <= 48) return id
  const digest = createHash('sha256').update(`${extensionId}\0${localId}`).digest('hex').slice(0, 8)
  return `${id.slice(0, 39).replace(/-+$/, '')}-${digest}`
}

export function extensionAgentProvider(
  extension: { id: string; name?: string },
  declaration: AgentProviderDeclaration
): ExtensionAgentProvider {
  return {
    harnessId: extensionAgentHarnessId(extension.id, declaration.id),
    extensionId: extension.id,
    ...(extension.name ? { extensionName: extension.name } : {}),
    override: {
      extends: declaration.extends ?? 'acp',
      label: declaration.displayName,
      command: declaration.command,
      // A derived Agent keeps its base engine's arguments unless it lists its own.
      ...(declaration.args.length || !declaration.extends ? { args: { mode: 'replace', values: [...declaration.args] } } : {}),
      ...(Object.keys(declaration.env).length ? { env: { ...declaration.env } } : {})
    }
  }
}

/**
 * Last known extension Agents. `list()` stays synchronous for the catalog;
 * `refresh()` reloads from the extension registry and keeps the previous
 * list when that read fails.
 */
export class ExtensionAgentProviderSource {
  private current: readonly ExtensionAgentProvider[] = []
  private loader?: () => Promise<readonly ExtensionAgentProvider[]>
  private pending?: Promise<void>

  setLoader(loader: () => Promise<readonly ExtensionAgentProvider[]>): void {
    this.loader = loader
  }

  list(): readonly ExtensionAgentProvider[] {
    return this.current
  }

  refresh(): Promise<void> {
    if (!this.loader) return Promise.resolve()
    this.pending ??= this.loader()
      .then((providers) => { this.current = [...providers] })
      .catch(() => undefined)
      .finally(() => { this.pending = undefined })
    return this.pending
  }
}
