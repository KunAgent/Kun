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
}

const CUSTOM_TRANSPORT = 'acp'

/**
 * Read-only catalog of harness definitions: builtin entries merged with
 * user-defined ACP harnesses from config. Definitions colliding with a builtin
 * id are dropped.
 */
export class HarnessCatalog {
  constructor(
    private readonly deps: { custom: () => readonly CustomHarnessConfig[] } = {
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
}

function customToDefinition(entry: CustomHarnessConfig): unknown {
  return {
    id: entry.id as HarnessId,
    displayName: entry.displayName,
    transport: CUSTOM_TRANSPORT,
    detect: {
      command: entry.command,
      aliases: [],
      versionArgs: ['--version']
    },
    launch: { command: entry.command, args: entry.args, env: entry.env },
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
