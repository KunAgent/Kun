/**
 * Deep-link targets for the settings surface. Kept apart from the chat store
 * types so adding a settings destination touches one small module.
 * `settingsCategoryForRouteSection` maps each one to the page that owns it.
 */
export type SettingsRouteSection =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'providers'
  | 'gateway'
  | 'extensions'
  | 'write'
  | 'paper'
  | 'design'
  | 'imageGeneration'
  | 'mediaGeneration'
  /** Retired tab; the local speech provider now lives under media generation. */
  | 'speak'
  | 'speechToText'
  | 'agents'
  /** Third-party Agents page (Agent Center deep link). */
  | 'agentsHarnesses'
  /** Collaboration defaults page. */
  | 'agentsCollaboration'
  | 'projects'
  | 'agentRuntime'
  | 'laboratory'
  | 'subagents'
  | 'archives'
  | 'code'
  /** Code page, Git worktree tab. */
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
