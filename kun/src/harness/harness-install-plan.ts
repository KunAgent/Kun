import type { HarnessDefinition } from '../contracts/harness.js'
import type { HarnessInstallAction, HarnessInstallPlan } from '../contracts/harness-install.js'
import { resolveExecutable } from '../process/owned-process.js'
import { harnessExecutableEnv } from './harness-executable-env.js'

/** Selection happens on the runtime host, never from the renderer's platform or a submitted command. */
export async function harnessInstallPlan(definition: HarnessDefinition, action: HarnessInstallAction,
  platform: NodeJS.Platform = process.platform,
  resolve: (command: string) => Promise<string | undefined> = (command) => resolveExecutable(command, { env: harnessExecutableEnv() })
): Promise<HarnessInstallPlan | null> {
  if (!definition.builtin) return null
  const setup = definition.setup
  const entries = action === 'adapter'
    ? setup?.adapter ? [{ platform: 'any', command: setup.adapter.install }] : []
    : [...(setup?.install ?? []).filter((entry) => entry.platform === platform),
      ...(setup?.install ?? []).filter((entry) => entry.platform === 'any')]
  let unavailable: HarnessInstallPlan | null = null
  for (const entry of entries) {
    // Only repository-owned setup metadata can enter this resolver.
    const requirements = [platform === 'win32' ? 'powershell.exe' : 'bash',
      ...(entry.command.startsWith('brew ') ? ['brew'] : []),
      ...(entry.command.startsWith('npm ') ? ['npm'] : []),
      ...(entry.command.startsWith('curl ') ? ['curl'] : [])]
    let missingCommand: string | undefined
    for (const command of requirements) {
      const found = await resolve(command) || (platform === 'win32' && !command.includes('.') &&
        (await resolve(`${command}.cmd`) || await resolve(`${command}.exe`)))
      if (!found) { missingCommand = command; break }
    }
    const plan = { action, command: entry.command, platform, available: !missingCommand,
      ...(missingCommand ? { missingCommand } : {}) }
    if (plan.available) return plan
    unavailable ??= plan
  }
  return unavailable
}
