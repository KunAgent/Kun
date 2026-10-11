import type { HarnessDefinition } from '../../contracts/harness.js'
import type { HarnessProviderOverride } from '../../config/kun-config-harness-providers.js'
import type { AgentProviderModule } from './provider-module.js'

/**
 * Apply a user's label, argument and environment override. The executable
 * of a builtin engine is not part of its definition: detection and launch
 * read it as a command override so bundled and installer layouts still apply.
 */
export function applyLaunchOverride(
  definition: HarnessDefinition,
  override: HarnessProviderOverride | undefined
): HarnessDefinition {
  if (!override) return definition
  const launch = definition.launch && (override.args || override.env || override.secretEnv)
    ? {
        ...definition.launch,
        args: override.args?.mode === 'replace'
          ? [...override.args.values]
          : [...definition.launch.args, ...override.args?.values ?? []],
        env: { ...definition.launch.env, ...override.env },
        ...(definition.launch.secretEnv || override.secretEnv ? {
          secretEnv: [
            ...(definition.launch.secretEnv ?? []).filter((row) =>
              !override.secretEnv?.some((secret) => secret.name === row.name)),
            ...override.secretEnv ?? []
          ]
        } : {})
      }
    : definition.launch
  return {
    ...definition,
    ...(override.label ? { displayName: override.label } : {}),
    ...(launch ? { launch } : {})
  }
}

/** Only ACP engines run on a runtime that is not bound to one engine id. */
export function derivableProviderModule(module: AgentProviderModule | undefined): module is AgentProviderModule {
  return Boolean(module && module.definition.builtin && module.definition.transport === 'acp' &&
    module.definition.availability !== 'retired' && module.definition.launch)
}

/**
 * A renamed or patched build of a builtin ACP engine:
 * same protocol behaviour, credentials and failure explanations, its own
 * command. The base package's installer, updater and bundled executable do
 * not describe the derived command, and its history reader may not either.
 */
export function deriveProviderModule(
  base: AgentProviderModule,
  id: string,
  override: HarnessProviderOverride
): AgentProviderModule {
  const { historySource: _history, setup, variants: _variants, ...shared } = base.definition
  const command = override.command ?? base.definition.launch!.command
  const definition = applyLaunchOverride({
    ...shared,
    id,
    displayName: override.label ?? id,
    detect: { command, aliases: [], versionArgs: base.definition.detect?.versionArgs ?? ['--version'] },
    launch: { ...base.definition.launch!, command },
    ...(setup?.docsUrl ? { setup: { docsUrl: setup.docsUrl } } : {}),
    derivedFrom: base.definition.id,
    builtin: false
  }, { ...override, label: undefined })
  const { installation: _installation, update: _update, bundled: _bundled, binaryEnv: _binaryEnv,
    resolveExecutable: _resolveExecutable, ...behaviour } = base
  return { ...behaviour, definition }
}
