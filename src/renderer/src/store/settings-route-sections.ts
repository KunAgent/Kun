/**
 * Deep-link targets for the settings surface. Kept apart from the chat store
 * types so adding a settings destination touches one small module.
 */
export type SettingsRouteSection =
  | 'general'
  | 'providers'
  | 'extensions'
  | 'write'
  | 'design'
  | 'imageGeneration'
  | 'mediaGeneration'
  /** Retired tab; the local speech provider now lives under media generation. */
  | 'speak'
  | 'speechToText'
  | 'agents'
  | 'laboratory'
  | 'subagents'
  | 'archives'
  | 'worktree'
  | 'memory'
  | 'permissions'
  | 'skill'
  | 'mcp'
  | 'shortcuts'
  | 'easterEgg'
  | 'claw'
  | 'updates'
  | 'terminal'
  | 'debug'
  | 'storage'
  | 'dataMigration'
