import { tmpdir } from 'node:os'
import type { HarnessDefinition } from '../contracts/harness.js'
import { CodexClient } from '../runtime/codex/codex-client.js'
import { startHarnessProcess } from '../session/harness-process.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'
import type { AcpReadiness } from './acp-readiness-probe.js'
import { nativeAgentNetworkEnv } from './native-agent-network.js'

/** A local protocol check; it does not start a thread or spend model quota. */
export async function probeCodexReadiness(
  definition: HarnessDefinition,
  command: string,
  options: { resolveSecretEnv?: HarnessSecretRefResolver } = {}
): Promise<AcpReadiness> {
  let process: Awaited<ReturnType<typeof startHarnessProcess>>
  try {
    const secretEnv = await resolveHarnessSecretEnv(definition, options.resolveSecretEnv)
    process = await startHarnessProcess({
      command,
      args: definition.launch?.args ?? ['app-server'],
      env: { ...nativeAgentNetworkEnv(definition, globalThis.process.env, secretEnv), ...definition.launch?.env },
      secretEnv,
      cwd: tmpdir()
    })
  } catch (error) {
    return { ready: 'no', detail: `spawn failed: ${message(error)}` }
  }

  try {
    await new CodexClient({ process }).initialize()
    return { ready: 'yes' }
  } catch (error) {
    const detail = [message(error), process.sanitizedStderrTail()]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 400)
    return {
      ready: /timed out|timeout/i.test(message(error)) ? 'unknown' : 'no',
      detail
    }
  } finally {
    await process.stop().catch(() => undefined)
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
