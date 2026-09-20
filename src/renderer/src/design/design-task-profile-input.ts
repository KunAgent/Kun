import type {
  DesignDocumentTarget,
  DesignPresetSource,
  DesignStyleSnapshot,
  DesignTaskProfile,
  DesignTaskProfileInput,
  DesignSystemPreset
} from '../agent/design-task-profile'
import type { DesignContext } from './design-context'
import { parseProjectDesignMd } from './design-md/design-md-adapter'
import { PROJECT_DESIGN_MD_PATH } from './design-md/design-md-paths'
import { rendererRuntimeClient } from '../agent/runtime-client'

export type DesignTaskProfileSelection = {
  outputMedium: 'html' | 'image'
  target: 'web' | 'app'
  preset: DesignSystemPreset
  presetSource?: DesignPresetSource
  styleSnapshot?: DesignStyleSnapshot
}

export type ResolvedDesignTaskProfileSelection = DesignTaskProfileSelection & {
  presetSource: DesignPresetSource
  styleSnapshot?: DesignStyleSnapshot
}

const DESIGN_STYLE_SNAPSHOT_MAX_CHARS = 16_000

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableJsonValue(child)])
  )
}

function rootDesignStyleSnapshot(
  parsed: NonNullable<ReturnType<typeof parseProjectDesignMd>['document']>
): DesignStyleSnapshot {
  const content = JSON.stringify(stableJsonValue({
    name: parsed.name,
    ...(parsed.description ? { description: parsed.description } : {}),
    colors: parsed.colors,
    typography: parsed.typography,
    rounded: parsed.rounded,
    spacing: parsed.spacing,
    components: parsed.components,
    extensions: parsed.extensions,
    sections: parsed.sections
  }))
  const truncated = content.length > DESIGN_STYLE_SNAPSHOT_MAX_CHARS
  return {
    version: 1,
    source: 'root-design-md',
    sourceHash: parsed.sourceHash,
    sourceName: parsed.name.trim().slice(0, 160),
    content: truncated
      ? `${content.slice(0, DESIGN_STYLE_SNAPSHOT_MAX_CHARS - 1)}…`
      : content,
    ...(truncated ? { truncated: true } : {})
  }
}

function snapshotDesignContext(context: DesignContext): DesignTaskProfileInput['context'] {
  return {
    ...(context.designType ? { designType: context.designType } : {}),
    ...(context.brandColor?.trim() ? { brandColor: context.brandColor.trim() } : {}),
    tone: [...(context.tone ?? [])],
    ...(context.designGuidelines?.trim()
      ? { designGuidelines: context.designGuidelines.trim() }
      : {}),
    ...(context.radius ? { radius: context.radius } : {}),
    ...(context.density ? { density: context.density } : {}),
    ...(context.fontStyle ? { fontStyle: context.fontStyle } : {})
  }
}

export function designContextFromTaskProfile(
  profile: Pick<DesignTaskProfileInput, 'target' | 'preset' | 'context'>
): DesignContext {
  return {
    designTarget: profile.target,
    designSystemPreset: profile.preset,
    ...profile.context,
    tone: [...profile.context.tone]
  }
}

type AutoPresetResolutionDeps = {
  readRootDesignMd?: (workspaceRoot: string) => Promise<{
    ok: boolean
    content?: string
    truncated?: boolean
  } | null>
  readWorkspaceDefaultPreset?: () => Promise<DesignSystemPreset | undefined>
}

async function defaultRootDesignMdReader(workspaceRoot: string) {
  if (typeof window === 'undefined' || !window.kunGui?.readWorkspaceFile) return null
  return window.kunGui.readWorkspaceFile({
    workspaceRoot,
    path: PROJECT_DESIGN_MD_PATH
  }).catch(() => null)
}

async function defaultWorkspacePresetReader(): Promise<DesignSystemPreset | undefined> {
  return (await rendererRuntimeClient.getSettings()).design.designSystemPreset
}

/** Resolve Auto once, before admission, so later settings/file changes cannot restyle the task. */
export async function resolveDesignTaskProfileSelection(
  selection: DesignTaskProfileSelection,
  workspaceRoot: string,
  deps: AutoPresetResolutionDeps = {}
): Promise<ResolvedDesignTaskProfileSelection> {
  if (selection.preset !== 'none') {
    return { ...selection, presetSource: 'explicit' }
  }
  const readRoot = deps.readRootDesignMd ?? defaultRootDesignMdReader
  const root = await readRoot(workspaceRoot).catch(() => null)
  const parsedRoot = root?.ok && root.content
    ? parseProjectDesignMd(root.content, { truncated: root.truncated })
    : null
  if (parsedRoot?.ok && parsedRoot.document) {
    return {
      ...selection,
      preset: 'none',
      presetSource: 'root-design-md',
      styleSnapshot: rootDesignStyleSnapshot(parsedRoot.document)
    }
  }
  const readDefault = deps.readWorkspaceDefaultPreset ?? defaultWorkspacePresetReader
  const workspacePreset = await readDefault().catch(() => undefined)
  if (workspacePreset && workspacePreset !== 'none') {
    return { ...selection, preset: workspacePreset, presetSource: 'workspace-default' }
  }
  return { ...selection, preset: 'none', presetSource: 'none' }
}

export function buildDesignTaskProfileInput(options: {
  selection: DesignTaskProfileSelection
  documentTarget: DesignDocumentTarget
  designContext: DesignContext
  lockedProfile?: DesignTaskProfile | null
  canvasEngine?: 'kun' | 'excalidraw'
}): DesignTaskProfileInput {
  if (options.lockedProfile) {
    if (
      options.lockedProfile.documentTarget.documentId !== options.documentTarget.documentId ||
      options.lockedProfile.documentTarget.boardArtifactId !== options.documentTarget.boardArtifactId
    ) {
      throw new Error('This Design task is locked to a different whiteboard document.')
    }
    const { lockedAtTurnId: _lockedAtTurnId, ...submitted } = options.lockedProfile
    return {
      ...submitted,
      documentTarget: { ...submitted.documentTarget },
      ...(submitted.styleSnapshot
        ? { styleSnapshot: { ...submitted.styleSnapshot } }
        : {}),
      context: { ...submitted.context, tone: [...submitted.context.tone] }
    }
  }
  return {
    version: 1,
    documentTarget: { ...options.documentTarget },
    outputMedium: options.selection.outputMedium,
    target: options.selection.target,
    preset: options.selection.preset,
    presetSource: options.selection.presetSource ?? (
      options.selection.preset === 'none' ? 'none' : 'explicit'
    ),
    ...(options.selection.styleSnapshot
      ? { styleSnapshot: { ...options.selection.styleSnapshot } }
      : {}),
    ...(options.canvasEngine === 'excalidraw' ? { canvasEngine: 'excalidraw' as const } : {}),
    context: snapshotDesignContext(options.designContext)
  }
}

export function applyDesignOutputContract(
  prompt: string,
  outputMedium: DesignTaskProfileInput['outputMedium']
): string {
  const contract = outputMedium === 'image'
    ? [
        'PRIMARY DESIGN OUTPUT CONTRACT: create an AI-generated raster image as the main deliverable.',
        'Use `generate_image`, then place the saved image on the bound whiteboard as an image shape.',
        'Do not create an HTML screen or silently fall back to HTML. Preserve this image lane for every revision.'
      ].join('\n')
    : [
        'PRIMARY DESIGN OUTPUT CONTRACT: create or edit an interactive HTML interface as the main deliverable.',
        'Use the linked Design HTML screen pipeline. Generated images may be supporting assets only.',
        'Do not replace the primary interface with a flat raster mockup.'
      ].join('\n')
  return `${contract}\n\n${prompt}`
}

export function applyDesignTaskProfileContract(
  prompt: string,
  profile: DesignTaskProfileInput
): string {
  const context = designContextFromTaskProfile(profile)
  const sourceInstruction = profile.presetSource === 'root-design-md' && profile.styleSnapshot
    ? [
        `Use the immutable root DESIGN.md snapshot captured at admission (name: ${profile.styleSnapshot.sourceName}; hash: ${profile.styleSnapshot.sourceHash}).`,
        'Do not re-read the current workspace file for this task; later file edits must not change the locked style.',
        `Locked parsed style snapshot: ${profile.styleSnapshot.content}`
      ].join('\n')
    : profile.presetSource === 'root-design-md'
      ? 'Legacy root DESIGN.md profile has no immutable snapshot; do not layer a conflicting preset.'
    : profile.presetSource === 'workspace-default'
      ? `Use the locked workspace-default preset: ${profile.preset}.`
      : profile.preset === 'none'
        ? 'No design-system preset is locked; follow only the remaining immutable context and the user brief.'
        : `Use the explicitly locked preset: ${profile.preset}.`
  const immutableContext = [
    'IMMUTABLE DESIGN TASK PROFILE (this thread snapshot outranks mutable Design settings):',
    `- Output: ${profile.outputMedium}`,
    `- Target: ${profile.target}`,
    `- Design preset: ${profile.preset} (source: ${profile.presetSource ?? 'legacy'})`,
    `- Bound document: ${profile.documentTarget.documentId}`,
    `- Bound board artifact: ${profile.documentTarget.boardArtifactId}`,
    `- Canvas engine: ${profile.canvasEngine === 'excalidraw' ? 'excalidraw' : 'kun'}`,
    sourceInstruction,
    `- Visual context snapshot: ${JSON.stringify(context)}`
  ].join('\n')
  if (profile.canvasEngine === 'excalidraw') {
    return [
      immutableContext,
      'EXCALIDRAW SKETCH CONTRACT: this bound drawing is an Excalidraw board.',
      'Do not call design_update_shapes, design_create_screen, design_arrange, or the HTML screen pipeline.',
      `Write or edit .kun-design/${profile.documentTarget.documentId}/excalidraw.json, then call design_apply_excalidraw.`,
      'Preserve live user element ids unless the user asked to replace the sketch. An empty board may receive a full scene write.',
      prompt
    ].join('\n\n')
  }
  return `${immutableContext}\n\n${applyDesignOutputContract(prompt, profile.outputMedium)}`
}
