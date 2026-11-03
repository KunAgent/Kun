import { z } from 'zod'
import type { TurnItem } from '../contracts/items.js'

export const FastContextTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  query: z.string().trim().min(1).max(4_000)
}).strict()
export type FastContextTask = z.infer<typeof FastContextTaskSchema>

const FastContextRangeSchema = z.tuple([
  z.number().int().positive(),
  z.number().int().positive()
])

export const FastContextEvidenceSchema = z.object({
  path: z.string().min(1).max(1_024),
  ranges: z.array(FastContextRangeSchema).min(1).max(8),
  excerpt: z.string().max(360).optional(),
  reason: z.string().max(240).optional()
}).strict()
export type FastContextEvidence = z.infer<typeof FastContextEvidenceSchema>

export const FastContextEvidenceTaskSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().min(1).max(240),
  query: z.string().min(1).max(4_000),
  evidence: z.array(FastContextEvidenceSchema).max(4),
  conclusion: z.string().max(700).optional(),
  uncertainties: z.array(z.string().min(1).max(360)).max(4)
}).strict()
export type FastContextEvidenceTask = z.infer<typeof FastContextEvidenceTaskSchema>

export const FastContextEvidencePackSchema = z.object({
  version: z.literal(1),
  tasks: z.array(FastContextEvidenceTaskSchema).min(1).max(4),
  uncertainties: z.array(z.string().min(1).max(360)).max(6)
}).strict()
export type FastContextEvidencePack = z.infer<typeof FastContextEvidencePackSchema>

const MAX_CANDIDATE_EVIDENCE = 16
const MAX_EVIDENCE_PER_TASK = 4

type SourceCallEvidence = {
  evidence: FastContextEvidence[]
  hint: string
  uncertainties: string[]
  taskIndexes?: number[]
  taskIndexesProvided: boolean
  provenanceRejected: boolean
}

/**
 * Converts completed managed source-tool calls into a compact, renderer-safe
 * evidence pack. It intentionally never serializes raw tool stdout or the
 * child's full conversation history into the parent tool result.
 */
export function buildFastContextEvidencePack(input: {
  tasks: readonly FastContextTask[]
  items: readonly TurnItem[]
  turnId: string
  summary?: string
  failure?: string
}): FastContextEvidencePack {
  const collected = collectEvidence(input.items, input.turnId)
  const conclusions = taskConclusions(input.summary, input.tasks.length)
  const assignments = assignEvidence(input.tasks, collected.calls)
  const commonUncertainties = unique([
    ...(input.failure ? [compact(input.failure, 360)] : []),
    ...(assignments.unattributedUncertainties),
    ...(collected.calls.length > 0
      ? []
      : ['No completed grep, glob, or read result was available for this retrieval run.'])
  ]).slice(0, 6)
  return {
    version: 1,
    tasks: input.tasks.map((task, index) => {
      const assignment = assignments.tasks[index] ?? { evidence: [], uncertainties: [] }
      const evidence = assignment.evidence
      const conclusion = conclusions.get(index)
      const uncertainties = [...assignment.uncertainties]
      if (evidence.length === 0) {
        uncertainties.push('No source-tool evidence could be confidently associated with this task.')
      }
      return {
        index,
        title: task.title,
        query: task.query,
        evidence,
        ...(conclusion ? { conclusion } : {}),
        uncertainties: [...new Set(uncertainties)].slice(0, 4)
      }
    }),
    uncertainties: commonUncertainties
  }
}

function collectEvidence(items: readonly TurnItem[], turnId: string): {
  calls: SourceCallEvidence[]
} {
  const results = new Map(
    items
      .filter((item): item is Extract<TurnItem, { kind: 'tool_result' }> =>
        item.turnId === turnId && item.kind === 'tool_result' &&
        (item.status === 'completed' || item.status === 'failed')
      )
      .map((item) => [item.callId, item])
  )
  const seen = new Set<string>()
  const calls: SourceCallEvidence[] = []
  let evidenceCount = 0
  for (const call of items) {
    if (call.turnId !== turnId || call.kind !== 'tool_call' || !isSourceTool(call.toolName)) continue
    const result = results.get(call.callId)
    if (!result) continue
    const evidence: FastContextEvidence[] = []
    if (!result.isError) {
      for (const entry of evidenceFromResult(call.toolName, call.arguments, result.output)) {
        const key = `${entry.path}:${JSON.stringify(entry.ranges)}:${entry.excerpt ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        if (evidenceCount >= MAX_CANDIDATE_EVIDENCE) continue
        evidence.push(entry)
        evidenceCount += 1
      }
    }
    const indexes = taskIndexes(call.arguments)
    calls.push({
      evidence,
      hint: searchableCall(call.toolName, call.arguments, evidence),
      uncertainties: [
        ...outputUncertainties(call.toolName, result.output),
        ...(result.isError ? [sourceErrorUncertainty(call.toolName, result.output)] : [])
      ],
      ...(indexes ? { taskIndexes: indexes } : {}),
      taskIndexesProvided: hasTaskIndexes(call.arguments),
      provenanceRejected: taskIndexesRejected(result.output)
    })
  }
  return { calls }
}

function isSourceTool(name: string): name is 'grep' | 'glob' | 'read' {
  return name === 'grep' || name === 'glob' || name === 'read'
}

function evidenceFromResult(
  toolName: 'grep' | 'glob' | 'read',
  args: Record<string, unknown>,
  output: unknown
): FastContextEvidence[] {
  const value = record(output)
  if (!value) return []
  if (toolName === 'grep') return grepEvidence(value, args)
  if (toolName === 'read') return readEvidence(value, args)
  // Glob establishes candidates but has no defensible source line range, so
  // it stays out of the renderer evidence contract until a later grep/read.
  return []
}

function grepEvidence(value: Record<string, unknown>, args: Record<string, unknown>): FastContextEvidence[] {
  const pattern = text(args.pattern)
  const matches = Array.isArray(value.matches) ? value.matches : []
  return matches.flatMap((match) => {
    const entry = record(match)
    const path = pathFrom(entry, value) || pathFrom(args)
    const line = positive(entry?.line_number) ?? positive(entry?.line)
    if (!entry || !path || !line) return []
    return [{
      path,
      ranges: [[line, line]],
      ...(text(entry.text) ? { excerpt: compact(text(entry.text), 360) } : {}),
      ...(pattern ? { reason: `grep match for ${compact(pattern, 160)}` } : { reason: 'grep match' })
    }]
  })
}

function readEvidence(value: Record<string, unknown>, args: Record<string, unknown>): FastContextEvidence[] {
  const path = pathFrom(value) || pathFrom(args)
  const start = positive(value.start_line)
  if (!path || !start) return []
  const end = positive(value.end_line)
  const excerpt = text(value.content)
  return [{
    path,
    ranges: [[start, Math.max(start, end ?? start)]],
    ...(excerpt ? { excerpt: compact(excerpt, 360) } : {}),
    reason: 'local file read'
  }]
}

function assignEvidence(tasks: readonly FastContextTask[], calls: readonly SourceCallEvidence[]): {
  tasks: Array<{ evidence: FastContextEvidence[]; uncertainties: string[] }>
  unattributedUncertainties: string[]
} {
  const assignments = tasks.map(() => ({ evidence: [] as FastContextEvidence[], uncertainties: [] as string[] }))
  const unattributedUncertainties: string[] = []
  for (const call of calls) {
    const explicitTaskIndexes = validTaskIndexes(call.taskIndexes, tasks.length)
    if (call.provenanceRejected || (call.taskIndexesProvided && !explicitTaskIndexes)) {
      unattributedUncertainties.push(
        ...call.uncertainties,
        ...(call.provenanceRejected
          ? []
          : ['Source call had invalid task_indexes; task attribution was withheld.'])
      )
      continue
    }
    for (const evidence of call.evidence) {
      const assignedTaskIndexes = explicitTaskIndexes ??
        (tasks.length === 1 ? [0] : indices(bestTaskIndex(tasks, searchableEvidence(evidence))))
      for (const assignedTaskIndex of assignedTaskIndexes) {
        if (assignments[assignedTaskIndex]!.evidence.length >= MAX_EVIDENCE_PER_TASK) continue
        assignments[assignedTaskIndex]!.evidence.push(evidence)
      }
    }
    if (call.uncertainties.length === 0) continue
    const assignedTaskIndexes = explicitTaskIndexes ??
      (tasks.length === 1 ? [0] : indices(bestTaskIndex(tasks, call.hint)))
    if (assignedTaskIndexes.length === 0) unattributedUncertainties.push(...call.uncertainties)
    else for (const assignedTaskIndex of assignedTaskIndexes) {
      assignments[assignedTaskIndex]!.uncertainties.push(...call.uncertainties)
    }
  }
  return {
    tasks: assignments.map((assignment) => ({
      evidence: assignment.evidence,
      uncertainties: unique(assignment.uncertainties).slice(0, 4)
    })),
    unattributedUncertainties: unique(unattributedUncertainties)
      .map((entry) => `Unattributed source uncertainty: ${entry}`)
  }
}

function bestTaskIndex(tasks: readonly FastContextTask[], searchable: string): number | undefined {
  let bestIndex: number | undefined
  let bestScore = 0
  for (const [index, task] of tasks.entries()) {
    const score = taskScore(task, searchable)
    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  return bestIndex
}

function taskScore(task: FastContextTask, searchable: string): number {
  const source = searchable.toLowerCase()
  return words(`${task.title} ${task.query}`)
    .reduce((score, term) => source.includes(term) ? score + 1 : score, 0)
}

function taskIndexes(args: Record<string, unknown>): number[] | undefined {
  return Array.isArray(args.task_indexes) &&
    args.task_indexes.every((value) => typeof value === 'number' && Number.isInteger(value))
    ? args.task_indexes
    : undefined
}

function validTaskIndexes(value: readonly number[] | undefined, taskCount: number): number[] | undefined {
  if (
    !value?.length ||
    value.length > taskCount ||
    value.some((index) => index < 1 || index > taskCount) ||
    new Set(value).size !== value.length
  ) return undefined
  return value.map((index) => index - 1)
}

function hasTaskIndexes(args: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(args, 'task_indexes')
}

function indices(value: number | undefined): number[] {
  return value === undefined ? [] : [value]
}

function searchableEvidence(evidence: FastContextEvidence): string {
  return `${evidence.path} ${evidence.excerpt ?? ''} ${evidence.reason ?? ''}`
}

function searchableCall(
  toolName: 'grep' | 'glob' | 'read',
  args: Record<string, unknown>,
  evidence: readonly FastContextEvidence[]
): string {
  return `${toolName} ${compact(JSON.stringify(args), 4_000)} ${evidence.map(searchableEvidence).join(' ')}`
}

function outputUncertainties(toolName: 'grep' | 'glob' | 'read', output: unknown): string[] {
  const value = record(output)
  if (!value) return []
  const prefix = toolName === 'read' ? 'Read' : toolName === 'grep' ? 'Search' : 'Glob'
  const uncertainties: string[] = []
  if (value.command_timed_out === true) uncertainties.push(`${prefix} command timed out; results may be incomplete.`)
  if (value.command_output_truncated === true) uncertainties.push(`${prefix} command output was truncated; results may be incomplete.`)
  if (value.truncated === true || value.has_more === true) {
    uncertainties.push(`${prefix} result was truncated; more source data may be available.`)
  }
  if (value.scan_byte_limit_reached === true) uncertainties.push(`${prefix} scan hit its byte limit; results may be incomplete.`)
  if (value.candidate_files_truncated === true) uncertainties.push(`${prefix} stopped at its candidate-file limit; ranking may have missed files.`)
  if (value.scope === 'definition_scope') {
    const searched = text(record(value.scope_hint)?.searched)
    uncertainties.push(`${prefix} covered only ${searched || 'the defining package'}, where the identifier is defined; references elsewhere were not searched.`)
  }
  return uncertainties.map((entry) => compact(entry, 360))
}

function sourceErrorUncertainty(toolName: 'grep' | 'glob' | 'read', output: unknown): string {
  const value = record(output)
  const detail = text(value?.error) || text(value?.message)
  const prefix = toolName === 'read' ? 'Read' : toolName === 'grep' ? 'Search' : 'Glob'
  return detail
    ? compact(`${prefix} tool failed: ${detail}`, 360)
    : `${prefix} tool failed; source results were unavailable.`
}

function taskIndexesRejected(output: unknown): boolean {
  return record(output)?.code === 'fast_context_task_indexes_required'
}

function taskConclusions(summary: string | undefined, taskCount: number): Map<number, string> {
  const result = new Map<number, string>()
  const source = summary?.trim()
  if (!source) return result
  const markers = [...source.matchAll(
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:\[?task\s*(\d+)\]?|任务\s*(\d+))(?:\*\*)?\s*[:：-](?:\*\*)?/gi
  )]
  for (const [index, marker] of markers.entries()) {
    const number = Number(marker[1] ?? marker[2]) - 1
    if (!Number.isInteger(number) || number < 0 || number >= taskCount) continue
    const start = (marker.index ?? 0) + marker[0].length
    const end = markers[index + 1]?.index ?? source.length
    const conclusion = compact(source.slice(start, end), 700)
    if (conclusion) result.set(number, conclusion)
  }
  if (taskCount === 1 && result.size === 0) result.set(0, compact(source, 700))
  return result
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function pathFrom(...values: Array<Record<string, unknown> | undefined>): string {
  for (const value of values) {
    const path = text(value?.relative_path) || text(value?.path)
    if (path) return compact(path, 1_024)
  }
  return ''
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function words(value: string): string[] {
  const ascii = value.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? []
  const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g) ?? [])
    .flatMap(cjkTerms)
  return [...new Set([...ascii, ...cjk])].slice(0, 24)
}

/**
 * Treat a CJK run as both a meaningful phrase and overlapping bigrams. This
 * lets a Chinese task match a Chinese path or excerpt without guessing an
 * English translation or assigning unrelated evidence on a zero score.
 */
function cjkTerms(run: string): string[] {
  const characters = [...run]
  const terms = [run]
  for (let index = 0; index < characters.length - 1; index += 1) {
    terms.push(characters.slice(index, index + 2).join(''))
  }
  return terms
}

function compact(value: string, maximum: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
