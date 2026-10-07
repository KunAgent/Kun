import { isDeepStrictEqual } from 'node:util'
import type { RuntimeConfigApplyRequest } from '../contracts/runtime-config.js'
import type { CapabilityToolProvider } from '../adapters/tool/capability-registry.js'
import {
  buildOfficeCliToolProviders,
  createConfiguredOfficeCliRunner
} from '../adapters/tool/office-cli-tool-provider.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

/**
 * The desktop refreshes the native Agent network policy before every Agent
 * probe/test/update check with a body that carries nothing else. Rebuilding
 * the whole Runtime generation for it took 3-10 s each time at startup and
 * restarted every stdio MCP server, so such requests only patch the option.
 */
export function isNativeNetworkOnlyApply(request: RuntimeConfigApplyRequest): boolean {
  const present = Object.entries(request).filter(([, value]) => value !== undefined)
  return present.length === 1 && present[0]![0] === 'nativeAgentNetwork'
}

type ReusableMcpProviders = {
  readonly diagnostics: ReadonlyArray<{ readonly status: string }>
}

/**
 * Keep live MCP connections across an apply whose MCP section is unchanged.
 * A set with any server that is not connected is rebuilt instead, so applying
 * settings still works as an explicit retry for broken servers.
 */
export function reusableMcpProviders<T extends ReusableMcpProviders>(
  current: T,
  currentOptions: Pick<KunServeRuntimeOptions, 'capabilities' | 'dataDir'>,
  nextOptions: Pick<KunServeRuntimeOptions, 'capabilities' | 'dataDir'>
): T | undefined {
  if (currentOptions.dataDir !== nextOptions.dataDir) return undefined
  if (!isDeepStrictEqual(currentOptions.capabilities?.mcp, nextOptions.capabilities?.mcp)) return undefined
  if (current.diagnostics.some((diagnostic) =>
    diagnostic.status !== 'connected' && diagnostic.status !== 'disabled')) return undefined
  return current
}

type OfficeCliRunner = NonNullable<ReturnType<typeof createConfiguredOfficeCliRunner>>
type OfficeCliParts = { runner: OfficeCliRunner | undefined; providers: CapabilityToolProvider[] }

/** One officecli runner per binary/profile: each new runner re-runs its diagnostics. */
export class OfficeCliRunnerReuse {
  private key: string | undefined
  private parts: OfficeCliParts | undefined

  seed(binaryPath: string | undefined, profileDir: string, parts: OfficeCliParts): void {
    this.key = officeCliKey(binaryPath, profileDir)
    this.parts = parts
  }

  resolve(binaryPath: string | undefined, profileDir: string): OfficeCliParts {
    const key = officeCliKey(binaryPath, profileDir)
    if (this.parts && this.key === key) return this.parts
    const runner = createConfiguredOfficeCliRunner({ binaryPath, profileDir })
    const providers = buildOfficeCliToolProviders({ binaryPath, profileDir, ...(runner ? { runner } : {}) })
    this.key = key
    this.parts = { runner, providers }
    return this.parts
  }
}

function officeCliKey(binaryPath: string | undefined, profileDir: string): string {
  return JSON.stringify([binaryPath?.trim() ?? '', profileDir])
}
