export type ManagedRuntimeStartupAttachDeps<Settings> = {
  ensure(settings: Settings): Promise<Settings>
  resolveExisting(settings: Settings): Promise<boolean>
}

/** Resolve an explicitly configured attach-only target when auto-start is disabled. */
export async function resolveManagedRuntimeStartupTarget<Settings>(
  settings: Settings,
  autoStart: boolean,
  deps: ManagedRuntimeStartupAttachDeps<Settings>
): Promise<Settings | null> {
  if (autoStart) return deps.ensure(settings)
  return await deps.resolveExisting(settings) ? settings : null
}
