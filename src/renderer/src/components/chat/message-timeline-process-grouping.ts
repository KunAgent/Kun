import type { ChatBlock, ToolBlock } from '../../agent/types'
import { blockHasPendingRuntimeWork } from './message-timeline-turns'
import { isFastContextToolBlock } from './fast-context-card-copy'
import { describeProcessBlock, getProcessDetail } from './message-timeline-process-detail'

export type ProcessSection = {
  id: string
  kind: 'reasoning' | 'execution' | 'output' | 'subagent'
  blocks: ChatBlock[]
}

/**
 * Built-in child-agent tools (or any block carrying child runtime metadata)
 * are rendered as "Kun Crew" subagent cards, not generic tool rows.
 */
export function isSubagentBlock(block: ChatBlock): boolean {
  if (block.kind !== 'tool') return false
  const meta = block.meta
  if (meta?.child && typeof meta.child === 'object') return true
  const toolName = typeof meta?.toolName === 'string' ? meta.toolName.trim() : ''
  return (
    toolName === 'delegate_task' ||
    toolName === 'generate_subagent' ||
    toolName === 'fast_context' ||
    toolName === 'explore_agent' ||
    toolName === 'ppt_agent'
  )
}

export function processBlockHasGeneratedMedia(block: ChatBlock): block is ToolBlock {
  if (block.kind !== 'tool' || block.status !== 'success') return false
  return (
    Array.isArray(block.meta?.attachments) && block.meta.attachments.length > 0
  ) || (
    Array.isArray(block.meta?.generatedFiles) && block.meta.generatedFiles.length > 0
  )
}

export function subagentParentTurnId(block: ChatBlock): string {
  if (block.kind !== 'tool') return ''
  const child = block.meta?.child
  if (child && typeof child === 'object') {
    const parent = (child as Record<string, unknown>).parentTurnId
    if (typeof parent === 'string' && parent.trim()) return parent.trim()
  }
  return ''
}

export function isExploreSubagentBlock(block: ChatBlock): boolean {
  return block.kind === 'tool' && isFastContextToolBlock(block)
}

export function sectionHasExploreBlock(section: ProcessSection): boolean {
  return section.blocks.some(isExploreSubagentBlock)
}

export function groupProcessSections(blocks: ChatBlock[]): ProcessSection[] {
  const sections: ProcessSection[] = []

  for (const block of blocks) {
    if (isSubagentBlock(block)) {
      const last = sections[sections.length - 1]
      // Coalesce sibling non-explore delegations of one turn (same parentTurnId)
      // into one swarm section. Explore cards stay independent so they never
      // land under an "N subagents" swarm shell.
      // Blocks without a parentTurnId only merge with an adjacent
      // parentTurnId-less non-explore subagent run.
      if (
        last &&
        last.kind === 'subagent' &&
        !isExploreSubagentBlock(block) &&
        !sectionHasExploreBlock(last)
      ) {
        const lastParent = subagentParentTurnId(last.blocks[0])
        const parent = subagentParentTurnId(block)
        if (lastParent === parent) {
          last.blocks.push(block)
          continue
        }
      }
      sections.push({ id: `subagent-${block.id}`, kind: 'subagent', blocks: [block] })
      continue
    }
    if (processBlockHasGeneratedMedia(block)) {
      sections.push({ id: `execution-${block.id}`, kind: 'execution', blocks: [block] })
      continue
    }
    if (block.kind === 'compaction') {
      sections.push({ id: `compaction-${block.id}`, kind: 'execution', blocks: [block] })
      continue
    }
    // Handoff markers stay standalone rows: merging them into an adjacent
    // execution section would bury the harness-switch boundary in a
    // generic "N steps" group.
    if (block.kind === 'handoff') {
      sections.push({ id: `handoff-${block.id}`, kind: 'execution', blocks: [block] })
      continue
    }
    const kind =
      block.kind === 'reasoning'
        ? 'reasoning'
        : block.kind === 'assistant'
          ? 'output'
          : 'execution'
    const last = sections[sections.length - 1]
    const followsGeneratedMedia = last?.blocks.some(processBlockHasGeneratedMedia) === true
    const followsStandaloneMarker = last?.blocks.some(
      (candidate) => candidate.kind === 'compaction' || candidate.kind === 'handoff'
    ) === true

    // Keep a real assistant text update as a hard timeline boundary, but fold
    // adjacent non-text work together. A long read/search/reason sequence does
    // not need to expand into dozens of empty process rows while it runs.
    // The expanded detail still preserves every original entry in order.
    const silentProcessPhase = kind === 'reasoning' || kind === 'execution'
    const previousIsSilentProcessPhase =
      last?.kind === 'reasoning' || last?.kind === 'execution'
    if (
      last &&
      !followsGeneratedMedia &&
      !followsStandaloneMarker &&
      silentProcessPhase &&
      previousIsSilentProcessPhase
    ) {
      if (last.kind === 'reasoning' && kind === 'reasoning') {
        last.blocks.push(block)
        continue
      }
      last.kind = 'execution'
      last.blocks.push(block)
      continue
    }

    if (last && !followsGeneratedMedia && !followsStandaloneMarker && last.kind === kind) {
      last.blocks.push(block)
      continue
    }
    sections.push({
      id: `${kind}-${block.id}`,
      kind,
      blocks: [block]
    })
  }

  return sections
}

export function getReasoningSectionText(section: ProcessSection): string {
  if (section.kind !== 'reasoning') return ''
  return section.blocks
    .filter(
      (block): block is Extract<ChatBlock, { kind: 'reasoning' }> => block.kind === 'reasoning'
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function sectionHasDetails(
  section: ProcessSection,
  t: (key: string, opts?: Record<string, unknown>) => string
): boolean {
  if (section.kind === 'reasoning') {
    return getReasoningSectionText(section).length > 0
  }
  if (section.kind === 'output') {
    return section.blocks.some(
      (block) => getProcessDetail(block, describeProcessBlock(block, t)).kind === 'assistant'
    )
  }
  if (section.blocks.length > 1) return true
  const [block] = section.blocks
  return block ? getProcessDetail(block, describeProcessBlock(block, t)).kind !== 'none' : false
}

export function processSectionHasActiveWork(
  section: ProcessSection,
  processing: boolean
): boolean {
  if (!processing) return false
  if (section.kind === 'reasoning') {
    return section.blocks.some((block) => block.id === 'live-reasoning')
  }
  if (section.kind === 'output') {
    return section.blocks.some((block) => block.id === 'live-assistant')
  }
  return section.blocks.some(
    (block) =>
      block.id === 'live-reasoning' ||
      block.id === 'live-assistant' ||
      blockHasPendingRuntimeWork(block)
  )
}

export function isRequestUserInputTool(block: ChatBlock): boolean {
  if (block.kind === 'user_input' && block.status === 'pending') return true
  if (block.kind !== 'tool' || block.status !== 'running') return false
  const toolName = typeof block.meta?.toolName === 'string' ? block.meta.toolName.trim() : ''
  if (toolName === 'request_user_input' || toolName === 'user_input') return true
  return /^request_user_input\s*:/i.test(block.summary.trim())
}

export type ProcessErrorTone = 'tool' | 'error' | null

export function processBlockErrorTone(block: ChatBlock): ProcessErrorTone {
  if (block.kind === 'tool' && block.status === 'error') return 'tool'
  if (block.kind === 'compaction' && block.status === 'error') return 'error'
  if (block.kind === 'approval' && block.status === 'error') return 'error'
  if (
    block.kind === 'approval_review' &&
    (block.status === 'timed-out' || block.status === 'failed-closed')
  ) return 'error'
  if (block.kind === 'user_input' && block.status === 'error') return 'error'
  if (block.kind === 'system' && block.severity === 'error') return 'error'
  return null
}

export function processSectionErrorTone(blocks: ChatBlock[]): ProcessErrorTone {
  let fallback: ProcessErrorTone = null
  for (const block of blocks) {
    const tone = processBlockErrorTone(block)
    if (tone === 'error') return tone
    if (tone === 'tool') fallback = tone
  }
  return fallback
}

export function processErrorTextClass(tone: ProcessErrorTone): string {
  if (tone === 'tool') return 'text-orange-700 dark:text-orange-300'
  if (tone === 'error') return 'text-red-600 dark:text-red-300'
  return 'text-ds-muted'
}

export function processErrorDotClass(tone: ProcessErrorTone): string {
  if (tone === 'tool') return 'bg-orange-500 dark:bg-orange-300'
  if (tone === 'error') return 'bg-red-500 dark:bg-red-300'
  return ''
}

export function sectionHasRequestUserInput(section: ProcessSection): boolean {
  return section.blocks.some(isRequestUserInputTool)
}

export function isPendingApproval(block: ChatBlock): boolean {
  return block.kind === 'approval' && block.status === 'pending'
}

export function sectionHasPendingApproval(section: ProcessSection): boolean {
  return section.blocks.some(isPendingApproval)
}
