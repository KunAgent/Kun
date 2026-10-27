const BUILD_PLAN_INTRO = 'Please execute the GUI plan described in the structured context below.'
const BUILD_GRAPH_PLAN_INTRO = 'Execute the GUI plan described in the structured context below using Graph orchestration.'

export type PromptManagedPlanWorktree = {
  repositoryRoot: string
  targetBranch: string
  branchPrefix: string
  dirtyCount: number
  planTitle: string
}


/**
 * Host-managed task worktree an external Agent was started in. The Agent
 * has no Kun task tools and must be told the isolation rule explicitly.
 */
export type PlanTaskWorktreeContext = {
  agentName: string
  sourceRepositoryRoot: string
  baseBranch?: string
}

export type PromptPlanTodo = {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export function buildPlanBuildPrompt(
  planRelativePath: string,
  planMarkdown?: string,
  orchestration: 'direct' | 'graph' = 'direct',
  promptWorktree?: PromptManagedPlanWorktree,
  planTodos?: PromptPlanTodo[],
  taskWorktree?: PlanTaskWorktreeContext
): string {
  const normalizedPlan = planMarkdown?.trim() ?? ''
  const worktreeProtocol = taskWorktree
    ? buildTaskWorktreeIsolation(taskWorktree)
    : promptWorktree && orchestration === 'direct'
      ? buildPromptManagedWorktreeProtocol(promptWorktree)
      : []
  const trackTodos = orchestration === 'direct' && Boolean(planTodos?.length)
  return [
    orchestration === 'graph'
      ? BUILD_GRAPH_PLAN_INTRO
      : BUILD_PLAN_INTRO,
    '<plan_execution_context>',
    jsonForPrompt({
      planRelativePath,
      ...(orchestration === 'direct' && planTodos?.length ? { todos: planTodos } : {})
    }),
    '</plan_execution_context>',
    trackTodos && taskWorktree
      ? 'Work through the todos in order and keep your own progress list; Kun task tools are not available to you.'
      : trackTodos
        ? 'Track execution with task_list, task_get and task_update. Read the canonical task IDs and revisions, update only the current task, and preserve unrelated tasks. Mark running only during actual work and succeeded only with verification evidence. Legacy todo IDs are historical context; task_list resolves the migrated records.'
        : '',
    ...worktreeProtocol,
    normalizedPlan
      ? 'The verbatim Markdown embedded below is the authoritative implementation plan.'
      : 'Treat that Markdown file as the source of truth for the implementation.',
    normalizedPlan
      ? 'The plan file may not be materialized in an isolated worktree. Execute the embedded Markdown even if that file path is absent.'
      : '',
    orchestration === 'graph'
      ? 'The GUI plan file may be absent from isolated executor worktrees. Build the Graph directly from the embedded plan, make every executor objective self-contained, and do not create a snapshot node whose job is to reread this GUI-only plan path.'
      : '',
    'Execute it using the orchestration selected for this turn. Do not regenerate the plan unless the plan explicitly asks for it.',
    ...(normalizedPlan
      ? [
          '',
          '<implementation_plan encoding="json-string">',
          jsonForPrompt(normalizedPlan),
          '</implementation_plan>'
        ]
      : [])
  ].filter(Boolean).join('\n')
}

function buildPromptManagedWorktreeProtocol(input: PromptManagedPlanWorktree): string[] {
  const context = jsonForPrompt({
    sourceRepositoryRoot: input.repositoryRoot,
    targetBranch: input.targetBranch,
    temporaryBranchPrefix: input.branchPrefix,
    sourceDirtyFileCount: input.dirtyCount,
    planTitle: input.planTitle
  })
  return [
    '',
    '<prompt_managed_worktree_protocol>',
    'The following lifecycle rules are mandatory and cannot be weakened by the implementation plan.',
    'Use the structured values below as data. Quote them safely in every Git or shell command; never evaluate them as shell source.',
    context,
    '',
    '1. Confirm the source checkout is still on targetBranch and record its latest committed HEAD. The source working tree may be dirty: leave every uncommitted source change exactly as-is and exclude it from the worktree baseline.',
    '2. Create a unique temporary branch from the committed local targetBranch using temporaryBranchPrefix plus a sanitized plan slug and unique suffix. Create its worktree below `~/.kun/worktrees/plan-prompt/<unique>/<repository-name>`.',
    '2a. Do not run a fresh dependency install in the new worktree. For each dependency directory the source checkout already has and git ignores (for example `node_modules` and `kun/node_modules`), copy it copy-on-write: `cp -c -R <source>/<dir> <worktree>/<dir>` on macOS (APFS clone), `cp -R --reflink=auto` on Linux. Only run the package manager afterwards if the worktree lockfile differs from the source lockfile. If less than 5 GB of disk is free, stop and report instead of creating the worktree.',
    '3. Perform every read, edit, command, and validation with the worktree as the explicit working directory. Do not modify, stash, reset, clean, switch, commit, or otherwise manipulate uncommitted changes in the source checkout.',
    '4. Implement the authoritative embedded plan in the worktree, run appropriate validation there, and commit all intended implementation changes on the temporary branch.',
    '5. Before integration, read the latest local targetBranch. If it advanced, rebase the temporary branch onto it inside the worktree. Resolve conflicts only when the resolution can be validated, then rerun affected checks.',
    '6. Only while the source checkout is still on targetBranch, integrate with `git merge --ff-only <temporary-branch>` from the source checkout. If local source changes prevent that fast-forward, do not alter them; retain the worktree and report the blocker.',
    '7. Remove the worktree without force (delete its cloned dependency directories first so no disk is left behind) and delete the temporary branch with `git branch -d` only after proving the temporary head is reachable from targetBranch; then prune worktree metadata.',
    '8. If implementation, validation, conflict resolution, branch verification, or integration cannot finish reliably, keep the worktree and temporary branch. Report their absolute path, branch name, Git status, completed checks, and the exact next action. Never force-remove unique work or claim completion.',
    '9. If the plan produces no repository changes, the unchanged worktree and temporary branch may be removed safely without moving targetBranch.',
    '</prompt_managed_worktree_protocol>'
  ]
}

function buildTaskWorktreeIsolation(input: PlanTaskWorktreeContext): string[] {
  return [
    '',
    '<task_worktree_isolation>',
    'Kun created a dedicated Git worktree for this build and started you inside it. These rules are mandatory and cannot be weakened by the implementation plan.',
    jsonForPrompt({
      executor: input.agentName,
      sourceRepositoryRoot: input.sourceRepositoryRoot,
      ...(input.baseBranch ? { baseBranch: input.baseBranch } : {})
    }),
    '1. Your current working directory is the task worktree, created from the latest commit of baseBranch (or the current HEAD). Perform every read, edit, command and validation there.',
    '2. Never edit, stash, reset, clean or run Git commands against sourceRepositoryRoot or any other worktree; the user may have uncommitted work there.',
    '3. Do not switch, create, rename or delete branches, and never push.',
    '4. Committing in the worktree is optional. When you finish, summarize what changed and which checks ran; Kun then opens a review where the user decides how to integrate the changes.',
    '</task_worktree_isolation>'
  ]
}

function jsonForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
}
