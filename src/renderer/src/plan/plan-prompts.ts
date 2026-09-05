const GUI_PLAN_OPEN = '<gui_plan>'
const GUI_PLAN_CLOSE = '</gui_plan>'
/**
 * @deprecated Kept for legacy prompt compatibility only. New turns use
 * the native Kun `create_plan` tool; the renderer still emits a
 * brief tag-based fallback section for legacy providers.
 */
export const GUI_PLAN_CREATE_TOOL_NAME = 'create_plan'
const DRAFT_PLAN_INTRO = 'Kun is asking you to draft a GUI-owned implementation plan.'
const REFINE_PLAN_INTRO = 'Kun is asking you to revise an existing GUI-owned implementation plan.'
const LEGACY_DRAFT_PLAN_INTRO = 'DeepSeek GUI is asking you to draft a GUI-owned implementation plan.'
const LEGACY_REFINE_PLAN_INTRO = 'DeepSeek GUI is asking you to revise an existing GUI-owned implementation plan.'
const BUILD_PLAN_INTRO = 'Please execute the GUI plan described in the structured context below.'
const BUILD_GRAPH_PLAN_INTRO = 'Execute the GUI plan described in the structured context below using Graph orchestration.'
const LEGACY_BUILD_PLAN_INTRO = 'Please read and execute the GUI plan file at'
const DRAFT_PLAN_DISPLAY_PREFIX = 'Create plan:'
const REFINE_PLAN_DISPLAY_PREFIX = 'Revise plan:'
const BUILD_PLAN_DISPLAY_PREFIX = 'Build plan:'

export type GuiPlanPromptKind = 'draft' | 'refine' | 'build'

export type PromptManagedPlanWorktree = {
  repositoryRoot: string
  targetBranch: string
  branchPrefix: string
  dirtyCount: number
  planTitle: string
}

export function buildDraftPlanPrompt(options: {
  request: string
  workspaceRoot: string
  planRelativePath: string
}): string {
  return [
    DRAFT_PLAN_INTRO,
    `The GUI will save your answer into \`${options.planRelativePath}\`.`,
    `You MUST use the \`${GUI_PLAN_CREATE_TOOL_NAME}\` tool to save the plan. Call it exactly once with:`,
    `- \`operation\` set to \`draft\``,
    `- \`markdown\` set to the complete plan Markdown`,
    `- \`source_request\` set to the user request`,
    `- \`title\` set to a short feature title`,
    `- \`plan_relative_path\` set to \`${options.planRelativePath}\``,
    `Do not call any other tools for this planning turn. Do not edit project files directly.`,
    '',
    'User request:',
    options.request.trim(),
    '',
    'Suggested Markdown structure (write the full plan into the tool call):',
    'Every independently executable implementation or test step MUST be a short task checkbox. Use one task per checkbox. Do not use task checkboxes in Summary. Put supporting detail in indented paragraphs below its task.',
    GUI_PLAN_OPEN,
    '# <short feature title>',
    '',
    '## Summary',
    '<goal and scope in prose>',
    '',
    '## Implementation',
    '### Phase one',
    '- [ ] <one independently executable task>',
    '- [ ] <one independently executable task>',
    '',
    '## Tests',
    '- [ ] <one test task>',
    GUI_PLAN_CLOSE
  ].join('\n')
}

export function buildRefinePlanPrompt(options: {
  feedback: string
  currentPlan: string
  workspaceRoot: string
  planRelativePath: string
}): string {
  return [
    REFINE_PLAN_INTRO,
    `The GUI will overwrite \`${options.planRelativePath}\` with your revised Markdown.`,
    `You MUST use the \`${GUI_PLAN_CREATE_TOOL_NAME}\` tool to save the revised plan. Call it exactly once with:`,
    `- \`operation\` set to \`refine\``,
    `- \`markdown\` set to the complete revised Markdown`,
    `- \`source_request\` set to the original request if known`,
    `- \`title\` set to the existing or updated short feature title`,
    `- \`plan_relative_path\` set to \`${options.planRelativePath}\``,
    `Do not call any other tools for this planning turn. Do not edit project files directly.`,
    '',
    'User feedback:',
    options.feedback.trim(),
    '',
    'Current plan:',
    '```markdown',
    options.currentPlan.trim(),
    '```',
    '',
    'Suggested revised Markdown (write the full revised plan into the tool call):',
    'Keep existing task checkbox completion semantics. Every independently executable implementation or test step MUST be a short task checkbox; do not add task checkboxes to Summary.',
    GUI_PLAN_OPEN,
    '<complete revised markdown plan>',
    GUI_PLAN_CLOSE
  ].join('\n')
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
  planTodos?: PromptPlanTodo[]
): string {
  const normalizedPlan = planMarkdown?.trim() ?? ''
  const worktreeProtocol = promptWorktree && orchestration === 'direct'
    ? buildPromptManagedWorktreeProtocol(promptWorktree)
    : []
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
    orchestration === 'direct' && planTodos?.length
      ? 'Track execution with todo_list and todo_write. Reuse the stable todo IDs in plan_execution_context, replace the full list without deleting unrelated todos, mark a task in_progress before work, and completed only after verification.'
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
    '3. Perform every read, edit, command, and validation with the worktree as the explicit working directory. Do not modify, stash, reset, clean, switch, commit, or otherwise manipulate uncommitted changes in the source checkout.',
    '4. Implement the authoritative embedded plan in the worktree, run appropriate validation there, and commit all intended implementation changes on the temporary branch.',
    '5. Before integration, read the latest local targetBranch. If it advanced, rebase the temporary branch onto it inside the worktree. Resolve conflicts only when the resolution can be validated, then rerun affected checks.',
    '6. Only while the source checkout is still on targetBranch, integrate with `git merge --ff-only <temporary-branch>` from the source checkout. If local source changes prevent that fast-forward, do not alter them; retain the worktree and report the blocker.',
    '7. Remove the worktree without force and delete the temporary branch with `git branch -d` only after proving the temporary head is reachable from targetBranch; then prune worktree metadata.',
    '8. If implementation, validation, conflict resolution, branch verification, or integration cannot finish reliably, keep the worktree and temporary branch. Report their absolute path, branch name, Git status, completed checks, and the exact next action. Never force-remove unique work or claim completion.',
    '9. If the plan produces no repository changes, the unchanged worktree and temporary branch may be removed safely without moving targetBranch.',
    '</prompt_managed_worktree_protocol>'
  ]
}

function jsonForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
}

export function isGuiPlanInternalPrompt(text: string): boolean {
  return getGuiPlanPromptKind(text) !== null
}

export function isGuiPlanDraftOrRefinePrompt(text: string): boolean {
  const kind = getGuiPlanPromptKind(text)
  return kind === 'draft' || kind === 'refine'
}

export function getGuiPlanPromptKind(text: string): GuiPlanPromptKind | null {
  const normalized = text.trim()
  if (
    normalized.includes(DRAFT_PLAN_INTRO) ||
    normalized.includes(LEGACY_DRAFT_PLAN_INTRO) ||
    normalized.startsWith(DRAFT_PLAN_DISPLAY_PREFIX) ||
    normalized === 'Create GUI plan'
  ) {
    return 'draft'
  }
  if (
    normalized.includes(REFINE_PLAN_INTRO) ||
    normalized.includes(LEGACY_REFINE_PLAN_INTRO) ||
    normalized.startsWith(REFINE_PLAN_DISPLAY_PREFIX) ||
    normalized === 'Revise GUI plan'
  ) {
    return 'refine'
  }
  if (
    normalized.includes(BUILD_PLAN_INTRO) ||
    normalized.includes(BUILD_GRAPH_PLAN_INTRO) ||
    normalized.includes(LEGACY_BUILD_PLAN_INTRO) ||
    normalized.startsWith(BUILD_PLAN_DISPLAY_PREFIX) ||
    normalized === 'Build GUI plan'
  ) {
    return 'build'
  }
  return null
}

export function formatGuiPlanPromptForDisplay(text: string): string | null {
  const normalized = text.trim()
  if (normalized.includes(DRAFT_PLAN_INTRO) || normalized.includes(LEGACY_DRAFT_PLAN_INTRO)) {
    const request = readSectionAfter(normalized, 'User request:')
    return request ? `Create plan: ${request}` : 'Create GUI plan'
  }
  if (normalized.includes(REFINE_PLAN_INTRO) || normalized.includes(LEGACY_REFINE_PLAN_INTRO)) {
    const feedback = readSectionBetween(normalized, 'User feedback:', 'Current plan:')
    return feedback ? `Revise plan: ${feedback}` : 'Revise GUI plan'
  }
  if (
    normalized.includes(BUILD_PLAN_INTRO) ||
    normalized.includes(BUILD_GRAPH_PLAN_INTRO) ||
    normalized.includes(LEGACY_BUILD_PLAN_INTRO)
  ) {
    const encodedContext = readSectionBetween(
      normalized,
      '<plan_execution_context>',
      '</plan_execution_context>'
    )
    let path: string | undefined
    try {
      const parsed = JSON.parse(encodedContext) as { planRelativePath?: unknown }
      path = typeof parsed.planRelativePath === 'string' ? parsed.planRelativePath : undefined
    } catch {
      path = normalized.match(/`([^`]+\.md)`/)?.[1]
    }
    return path ? `Build plan: ${path}` : 'Build GUI plan'
  }
  return null
}

export function extractGuiPlanMarkdown(text: string): string {
  const raw = text.trim()
  if (!raw) return ''
  const openIndex = raw.indexOf(GUI_PLAN_OPEN)
  if (openIndex >= 0) {
    const bodyStart = openIndex + GUI_PLAN_OPEN.length
    const closeIndex = raw.indexOf(GUI_PLAN_CLOSE, bodyStart)
    const body = closeIndex >= 0 ? raw.slice(bodyStart, closeIndex) : raw.slice(bodyStart)
    return stripMarkdownFence(body.trim())
  }
  return stripMarkdownFence(raw)
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  return (match?.[1] ?? trimmed).trim()
}

function readSectionAfter(text: string, marker: string): string {
  const index = text.indexOf(marker)
  if (index < 0) return ''
  return text.slice(index + marker.length).trim()
}

function readSectionBetween(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker)
  if (start < 0) return ''
  const bodyStart = start + startMarker.length
  const end = text.indexOf(endMarker, bodyStart)
  return text.slice(bodyStart, end >= 0 ? end : undefined).trim()
}
