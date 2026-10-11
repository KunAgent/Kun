import type { ThreadService } from '../services/thread-service.js'
import type { TurnService } from '../services/turn-service.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { PptWorkflowScope } from '../ports/tool-host.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'

export type ChildDelegatedRuntimeFactory = (input: {
  threads: ThreadService
  turns: TurnService
  sessionStore: SessionStore
  threadStore: ThreadStore
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  prefix: ImmutablePrefix
  toolPolicy: 'readOnly' | 'inherit'
  allowedModelProviderIds?: readonly string[]
  allowedModelIds?: readonly string[]
  allowedToolNames?: readonly string[]
  allowedProviderIds?: readonly string[]
  allowedSkillIds?: readonly string[]
  allowedReadPaths?: readonly string[]
  allowHostReads?: boolean
  allowedWritePaths?: readonly string[]
  allowedArtifactIds?: readonly string[]
  blockedToolNames?: readonly string[]
  blockedProviderIds?: readonly string[]
  blockedSkillIds?: readonly string[]
  skillsEnabled: boolean
  instructionsEnabled: boolean
  memoryEnabled: boolean
  pptWorkflowScope?: PptWorkflowScope
}) => {
  /** Legacy provider-inference view (used when the harness router is off). */
  delegated?: DelegatedTurnRuntime
  /** Child-scoped harness router; shares the global catalog. */
  router?: import('../harness/harness-router.js').HarnessRouter
} | undefined
