import {
  HarnessDefinitionSchema,
  type HarnessDefinition,
  type HarnessId
} from '../contracts/harness.js'
import { ACP_DEFAULT_CAPABILITIES, BUILTIN_HARNESSES } from './builtin-harnesses.js'

export type CustomHarnessConfig = {
  id: string
  displayName: string
  command: string
  args: string[]
  env: Record<string, string>
  /** Credential-store refs resolved into env at spawn (P4-12). */
  secretEnv?: readonly { name: string; secretRef: string }[]
}

const CUSTOM_TRANSPORT = 'acp'

/**
 * Read-only catalog of harness definitions: builtin entries merged with
 * user-defined ACP harnesses from config. Definitions colliding with a builtin
 * id are dropped.
 */
export class HarnessCatalog {
  constructor(
    private readonly deps: {
      custom: () => readonly CustomHarnessConfig[]
      /** User-disabled builtin harness ids; they stay visible but unadmittable. */
      disabled?: () => readonly HarnessId[]
    } = {
      custom: () => []
    }
  ) {}

  list(): HarnessDefinition[] {
    const customs: HarnessDefinition[] = []
    for (const entry of this.deps.custom()) {
      const parsed = HarnessDefinitionSchema.safeParse(customToDefinition(entry))
      if (parsed.success && !BUILTIN_HARNESSES.some((d) => d.id === parsed.data.id)) {
        customs.push(parsed.data)
      }
    }
    return [...BUILTIN_HARNESSES, ...customs]
  }

  get(id: string): HarnessDefinition | undefined {
    return this.list().find((d) => d.id === id)
  }

  /**
   * Whether the user disabled this builtin harness. The native Kun loop is the
   * host runtime itself and can never be disabled through settings.
   */
  isDisabled(id: HarnessId): boolean {
    return id !== 'kun' && (this.deps.disabled?.() ?? []).includes(id)
  }
}

/** Build the catalog definition for a `harnesses.custom[]` entry (P4-12: also used by probe-definition). */
export function customToDefinition(entry: CustomHarnessConfig): unknown {
  return {
    id: entry.id as HarnessId,
    displayName: entry.displayName,
    transport: CUSTOM_TRANSPORT,
    detect: {
      command: entry.command,
      aliases: [],
      versionArgs: ['--version']
    },
    launch: {
      command: entry.command,
      args: entry.args,
      env: entry.env,
      secretEnv: entry.secretEnv ?? []
    },
    credentialModes: ['native-login'],
    permissionModes: [
      { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'probe',
    staticModels: [],
    capabilities: ACP_DEFAULT_CAPABILITIES,
    builtin: false
  }
}
