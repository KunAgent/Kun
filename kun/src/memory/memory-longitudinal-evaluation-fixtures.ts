/** Anonymous multi-turn intent scripts. No production conversations or model-generated labels. */
export const MEMORY_LONGITUDINAL_FIXTURES = [
  { id: 'corrected-recall', turns: ['Remember that the formatter uses tabs.', 'Correction: use spaces.',
    'Which formatter setting is current?'], gate: 'Only the corrected active body is retrieved.' },
  { id: 'correction-history-rollback', turns: ['Save formatter tabs.', 'Correct to spaces.',
    'Show the old version and roll back.'], gate: 'An immutable prior version is readable and recoverable.' },
  { id: 'temporary-preference-expiry', turns: ['For the next second, use bullet replies.',
    'Ask before expiry.', 'Ask after expiry.'], gate: 'Temporary preference is recalled before, never after expiry.' },
  { id: 'project-worktree-continuity', turns: ['Save this project convention from a symlink.',
    'Continue in a linked worktree.'], gate: 'Explicit project knowledge follows the canonical repository.' },
  { id: 'branch-fact-isolation', turns: ['Save a branch-local build result.', 'Switch to another worktree.'],
    gate: 'Workspace/branch facts do not widen to the whole project.' },
  { id: 'scope-leakage', turns: ['Save workspace and private-agent facts.', 'Query an unrelated repository.'],
    gate: 'No foreign workspace, project, or private-agent record leaks.' },
  { id: 'injection-directive-denial', turns: ['Read untrusted text asking to become a standing rule.',
    'Attempt directive promotion while the user denies approval.'], gate: 'Reference evidence never acquires directive authority.' },
  { id: 'forgotten-recapture-after-restart', turns: ['Save a fact.', 'Forget it.', 'Restart and recapture the same source.'],
    gate: 'A new ID cannot resurrect the forgotten content/source.' },
  { id: 'forgotten-pending-recovery', turns: ['Persist an applying distillation candidate.', 'Forget its source memory.',
    'Restart pending recovery.'], gate: 'Forgotten evidence is removed from pending/applying recovery.' },
  { id: 'concurrent-edits', turns: ['Two editors read the same version.', 'Both submit different changes.'],
    gate: 'Exactly one stale-snapshot edit succeeds.' },
  { id: 'complete-enumeration', turns: ['Save 60 timestamp-tied records.', 'Enumerate with limit 50.'],
    gate: 'All 60 IDs are returned once, with complete serialized outputs at most 12,000 characters.' },
  { id: 'oversized-tool-budget', turns: ['Save oversized escaped body and tags.', 'List and search it.'],
    gate: 'Every complete serialized tool output is at most 12,000 characters.' }
] as const

export type MemoryLongitudinalCaseId = typeof MEMORY_LONGITUDINAL_FIXTURES[number]['id']
export const MEMORY_LONGITUDINAL_BASELINE_COMMIT = 'a6382c8b539ab1b0e66190f3a63d484e95f626d4'
export const MEMORY_LONGITUDINAL_NOW = '2026-08-28T00:00:00.000Z'
