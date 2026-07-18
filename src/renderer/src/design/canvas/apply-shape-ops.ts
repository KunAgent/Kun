import { executeOps, type ExecuteOpsOptions, type OpError } from './shape-ops'

export const DESIGN_CANVAS_TOOL_NAMES = new Set([
  'design_canvas',
  'design_create_screen',
  'design_update_shapes',
  'design_arrange',
  'design_export_canvas',
  'design_system_template',
  'design_system',
  'design_validate',
  'design_svg_create',
  'design_motion_set_timeline',
  'design_motion_upsert_keyframes',
  'design_motion_apply_preset',
  'design_motion_delete'
])

export function isDesignCanvasToolName(name: unknown): boolean {
  return typeof name === 'string' && DESIGN_CANVAS_TOOL_NAMES.has(name)
}

/**
 * Last turn's canvas-op errors, stashed by the apply hook and taken by the next
 * canvas turn so the agent SEES what failed (bad shape id, schema-invalid op,
 * missing parent) and self-corrects — instead of the op silently vanishing with
 * the agent believing it succeeded. One-shot: `take` reads and clears.
 *
 * Keyed by design document/artifact so two open designs never cross-contaminate
 * each other's error feedback. Callers that don't track a key use the shared
 * default bucket (the common single-active-board case).
 */
const DEFAULT_ERROR_KEY = '__default__'
const _lastCanvasOpErrors = new Map<string, OpError[]>()

export function canvasOpErrorKey(
  workspaceRoot: string | undefined | null,
  docId: string | undefined | null,
  artifactId: string | undefined | null
): string | undefined {
  const root = workspaceRoot?.trim()
  const doc = docId?.trim()
  const artifact = artifactId?.trim()
  return root && doc && artifact ? `${root}:${doc}:${artifact}` : undefined
}

export function setLastCanvasOpErrors(errors: OpError[], key: string = DEFAULT_ERROR_KEY): void {
  if (errors.length === 0) _lastCanvasOpErrors.delete(key)
  else _lastCanvasOpErrors.set(key, errors)
}

export function takeLastCanvasOpErrors(key: string = DEFAULT_ERROR_KEY): OpError[] {
  const errors = _lastCanvasOpErrors.get(key) ?? []
  _lastCanvasOpErrors.delete(key)
  return errors
}

/**
 * Extract every `shapeops` fenced code block from a markdown-ish string.
 * Tolerates leading/trailing whitespace inside the fence and json/array shapes.
 */
export function extractShapeOpsBlocks(text: string): unknown[][] {
  const out: unknown[][] = []
  const re = /```shapeops\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) out.push(parsed)
      else out.push([parsed])
    } catch {
      // ignore malformed JSON — executor will report via Zod when called with garbage
    }
  }
  return out
}

/**
 * Extract renderer-executed design canvas tool calls from assistant text.
 *
 * The model is instructed to "call" this as a fenced JSON block:
 *
 * ```design_canvas
 * { "action": "add_screen", "name": "Login", "width": 390, "height": 844 }
 * ```
 *
 * Keeping this as an explicit tool-shaped block lets the design agent decide
 * when a canvas/screen exists. The old `shapeops` fence remains supported for
 * existing turns and code-canvas compatibility.
 */
export function extractDesignCanvasToolBlocks(text: string): unknown[][] {
  const out: unknown[][] = []
  const re = /```design_canvas\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      const ops = normalizeDesignCanvasToolCall(parsed)
      if (ops.length > 0) out.push(ops)
    } catch {
      // ignore malformed JSON — the next model turn can self-correct
    }
  }
  return out
}

export function normalizeDesignCanvasToolCall(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    if (value.every((item) => isRecord(item) && typeof item.op === 'string')) {
      return value
    }
    return value.flatMap((item) => normalizeDesignCanvasToolCall(item))
  }
  if (!isRecord(value)) return []

  if (typeof value.op === 'string') {
    return [value]
  }

  const action = typeof value.action === 'string' ? value.action : ''
  if (action === 'create_board') {
    return []
  }
  if (action === 'update_shapes') {
    const ops = value.ops
    if (Array.isArray(ops)) return ops
    if (isRecord(ops)) return [ops]
    return []
  }
  if (action === 'add_screen') {
    return [
      copyOptionalFields(
        {
          op: 'add-screen',
          name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Screen'
        },
        value,
        ['brief', 'x', 'y', 'width', 'height', 'devicePreset']
      )
    ]
  }
  return []
}

export function extractCanvasOpBlocksFromValue(value: unknown): unknown[][] {
  if (isRecord(value) && Array.isArray(value.ops)) {
    return value.ops.length > 0 ? [value.ops] : []
  }
  const ops = normalizeDesignCanvasToolCall(value)
  return ops.length > 0 ? [ops] : []
}

export type SvgArtifactCreateSpec = {
  artifactId?: string
  name: string
  brief: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export function extractSvgArtifactCreateSpecsFromValue(value: unknown): SvgArtifactCreateSpec[] {
  if (!isRecord(value) || !Array.isArray(value.ops)) return []
  return value.ops.flatMap((entry) => {
    if (!isRecord(entry) || entry.op !== 'add-svg-artifact') return []
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const brief = typeof entry.brief === 'string' ? entry.brief.trim() : ''
    const artifactId = typeof entry.artifactId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.artifactId.trim())
      ? entry.artifactId.trim()
      : undefined
    if (!name || !brief) return []
    const number = (candidate: unknown): number | undefined =>
      typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined
    return [{
      ...(artifactId ? { artifactId } : {}),
      name,
      brief,
      ...(number(entry.x) !== undefined ? { x: number(entry.x) } : {}),
      ...(number(entry.y) !== undefined ? { y: number(entry.y) } : {}),
      ...(number(entry.width) !== undefined ? { width: number(entry.width) } : {}),
      ...(number(entry.height) !== undefined ? { height: number(entry.height) } : {})
    }]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function copyOptionalFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key]
  }
  return target
}

/**
 * Extract `design_canvas`, legacy `shapeops`, and compatible `json` blocks in a
 * SINGLE pass, preserving their order of appearance in the source text. This
 * source-ordering is what makes incremental (streaming) application safe: as
 * the assistant text grows token by token, completed blocks are only ever
 * appended, so the prefix of already-applied blocks never shifts. (The split
 * `[...design_canvas, ...shapeops]` form in `applyShapeOpsFromText` is fine for
 * a finished turn but would re-index blocks mid-stream when the two fence types
 * interleave.)
 *
 * Some models ignore the requested `design_canvas` fence and emit the exact
 * tool-call JSON under a plain `json` fence. We accept those only when the
 * parsed value normalizes to known canvas ops, so unrelated JSON examples remain
 * inert.
 *
 * Only COMPLETE, valid blocks are returned — the closing ``` is required by
 * the regex and malformed JSON is skipped — so a half-streamed block is simply
 * absent until it finishes.
 */
export function extractCanvasOpBlocks(text: string): unknown[][] {
  const out: unknown[][] = []
  const re = /```(design_canvas|shapeops|json)\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const fence = m[1]
    const raw = m[2].trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (fence === 'design_canvas' || fence === 'json') {
        const ops = normalizeDesignCanvasToolCall(parsed)
        if (ops.length > 0) out.push(ops)
      } else if (Array.isArray(parsed)) {
        out.push(parsed)
      } else {
        out.push([parsed])
      }
    } catch {
      // ignore malformed JSON — the next delta (or model turn) can self-correct
    }
  }
  return out
}

export type ApplyCanvasOpsSinceResult = {
  affectedIds: string[]
  errors: OpError[]
  /** Total number of complete canvas-op blocks currently present in `text`. */
  totalBlocks: number
}

export function applyCanvasOpBlocks(
  blocks: unknown[][],
  source = 'ai',
  options?: ExecuteOpsOptions
): ApplyShapeOpsResult {
  const affectedIds: string[] = []
  const errors: OpError[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    const result = executeOps(blocks[i], `${source}:${i}`, options)
    affectedIds.push(...result.affectedIds)
    errors.push(...result.errors)
  }
  return { affectedIds, errors, batchCount: blocks.length }
}

/**
 * Apply only the canvas-op blocks at index ≥ `startIndex` from `text`, executing
 * each as its own atomic undo batch. Returns the new total block count so the
 * caller can advance its cursor. This is the engine behind real-time streaming
 * application: call it repeatedly as the assistant text grows, passing the
 * previously-returned `totalBlocks` as the next `startIndex`, and each freshly
 * completed `design_canvas` call renders the moment its block closes.
 */
export function applyCanvasOpsSince(
  text: string,
  startIndex: number,
  options?: ExecuteOpsOptions
): ApplyCanvasOpsSinceResult {
  const blocks = extractCanvasOpBlocks(text)
  const result = applyCanvasOpBlocks(blocks.slice(Math.max(0, startIndex)), 'ai', options)
  return { affectedIds: result.affectedIds, errors: result.errors, totalBlocks: blocks.length }
}

export type ApplyShapeOpsResult = {
  affectedIds: string[]
  errors: OpError[]
  /** Number of canvas operation blocks parsed and executed (each is one undo batch). */
  batchCount: number
}

/**
 * Parse every design-canvas tool block in `text` and execute each as its own
 * atomic undo batch against the singleton canvas stores. Pure engine — no UI
 * side effects (no glow, no viewport focus). Callers layer those on top.
 *
 * One-shot convenience over `applyCanvasOpsSince(text, 0)` for callers that
 * apply a finished turn in a single pass.
 */
export function applyShapeOpsFromText(text: string): ApplyShapeOpsResult {
  const { affectedIds, errors, totalBlocks } = applyCanvasOpsSince(text, 0)
  return { affectedIds, errors, batchCount: totalBlocks }
}
