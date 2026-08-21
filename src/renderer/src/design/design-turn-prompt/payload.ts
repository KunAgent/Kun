import type { OpError } from '../canvas/shape-ops'
import type { CanvasDocument, CanvasShape } from '../canvas/canvas-types'
import type { CanvasSnapshot } from '../canvas/canvas-snapshot'
import { isHtmlFrame } from '../canvas/canvas-types'
import type { DesignSystem } from '../canvas/design-system-types'
import {
  auditDesignHtmlQuality,
  getDesignRuntimeQualityFindings,
  mergeDesignHtmlQualityFindings,
  type DesignHtmlQualityFinding
} from '../design-html-quality'
import {
  designSelectedContextLocations,
  type DesignComposerContextTarget,
  type DesignHtmlElementContext
} from '../design-composer-context'
import type { DesignArtifact } from '../design-types'
import { currentDesignArtifactVersion } from '../design-types'
import type { DesignWorkspaceState } from '../design-workspace-store-types'
import type { DerivedTokens } from '../design-token-extract'
import { buildHtmlSiblingManifest } from '../design-pages'
import { mergeDesignContextWithTokens } from '../design-context'
import { buildDesignTurnPrompt } from './entry'
import type { DesignFrameContext, DesignTurnTarget, ScreenManifestEntry } from './shared'
import { buildPrototypeHref } from './shared'

type PromptWorkspaceState = Pick<
  DesignWorkspaceState,
  | 'artifacts'
  | 'assistantModel'
  | 'assistantProviderId'
  | 'designContext'
  | 'documents'
  | 'activeDocumentId'
  | 'generationPrompt'
>

export type BuildDesignTurnPromptPayloadOptions = {
  target: DesignTurnTarget
  mode: 'text' | 'image'
  promptText: string
  artifactRelativePath: string
  workspaceRoot: string
  promptState: PromptWorkspaceState
  boardArtifact: DesignArtifact
  visibleTargets: readonly DesignComposerContextTarget[]
  canvasDocument: CanvasDocument
  designSystem: DesignSystem
  projectDesignMdSourceHash?: string
  tokensByArtifact: Record<string, DerivedTokens>
  designNotesPath?: string
  basePath?: string
  htmlArtifactId?: string
  htmlElementContext?: DesignHtmlElementContext
  canvasSnapshot?: CanvasSnapshot
  htmlFrameContext?: DesignFrameContext
  selectedFrame?: CanvasShape | null
  previousOpErrors?: OpError[]
  imageEditReferencePath?: string
}

export type DesignTurnPromptPayload = {
  prompt: string
  promptState: PromptWorkspaceState
}

function siblingTokenFields(
  tokensByArtifact: Record<string, DerivedTokens>,
  relativePath: string
): { accent?: string; fontFamily?: string } {
  const tokens = tokensByArtifact[relativePath]
  if (!tokens) return {}
  const accent = tokens.palette.primary?.base
  const fontFamily = tokens.typeRows.find((row) => row.fontFamily)?.fontFamily?.split(',')[0]?.trim()
  return { ...(accent ? { accent } : {}), ...(fontFamily ? { fontFamily } : {}) }
}

function buildScreenManifest(options: BuildDesignTurnPromptPayloadOptions): ScreenManifestEntry[] {
  if (options.target !== 'screen') return []
  const screenManifest: ScreenManifestEntry[] = []
  for (const shape of Object.values(options.canvasDocument.objects)) {
    if (!shape || !isHtmlFrame(shape) || shape.id === options.selectedFrame?.id) continue
    const linked = options.promptState.artifacts.find((artifact) => artifact.id === shape.htmlArtifactId)
    if (!linked) continue
    const summary = currentDesignArtifactVersion(linked)?.summary?.trim()
    screenManifest.push({
      name: shape.name,
      width: shape.width,
      height: shape.height,
      htmlPath: linked.relativePath,
      ...(summary ? { summary } : {}),
      ...siblingTokenFields(options.tokensByArtifact, linked.relativePath)
    })
  }
  return screenManifest
}

async function readWorkspaceText(workspaceRoot: string, path: string): Promise<string> {
  if (typeof window === 'undefined' || typeof window.kunGui?.readWorkspaceFile !== 'function') return ''
  const result = await window.kunGui.readWorkspaceFile({ path, workspaceRoot }).catch(() => null)
  return result?.ok ? result.content : ''
}

export async function readDesignHtmlQualityFindings(options: {
  workspaceRoot: string
  htmlPath?: string
  designNotesPath?: string
  siblingScreens?: ScreenManifestEntry[]
}): Promise<DesignHtmlQualityFinding[]> {
  const htmlPath = options.htmlPath?.trim()
  if (!htmlPath) return []
  const html = await readWorkspaceText(options.workspaceRoot, htmlPath)
  if (!html) return []
  const designNotesPath = options.designNotesPath?.trim()
  const designNotes = designNotesPath ? await readWorkspaceText(options.workspaceRoot, designNotesPath) : ''
  const siblingScreens = (options.siblingScreens ?? []).map((screen) => ({
    name: screen.name,
    htmlPath: screen.htmlPath,
    prototypeHref: buildPrototypeHref(htmlPath, screen.htmlPath)
  }))
  const staticFindings = auditDesignHtmlQuality({
    html,
    ...(designNotes ? { designNotes } : {}),
    ...(siblingScreens.length > 0 ? { siblingScreens } : {})
  })
  return mergeDesignHtmlQualityFindings(staticFindings, getDesignRuntimeQualityFindings(htmlPath))
}

function derivedTokensForTurn(
  options: BuildDesignTurnPromptPayloadOptions,
  htmlSiblingManifest: readonly ScreenManifestEntry[]
): DerivedTokens | undefined {
  let derivedTokens = options.basePath ? options.tokensByArtifact[options.basePath] : undefined
  if (!derivedTokens && (options.target === 'html' || options.target === 'screen')) {
    for (const sibling of htmlSiblingManifest) {
      if (options.tokensByArtifact[sibling.htmlPath]) {
        derivedTokens = options.tokensByArtifact[sibling.htmlPath]
        break
      }
    }
  }
  return derivedTokens
}

export async function buildDesignTurnPromptPayload(
  options: BuildDesignTurnPromptPayloadOptions
): Promise<DesignTurnPromptPayload> {
  const screenManifest = buildScreenManifest(options)
  const htmlSiblingManifest =
    options.target === 'html'
      ? buildHtmlSiblingManifest(options.promptState.artifacts, options.htmlArtifactId || null).map((entry) => ({
          ...entry,
          ...siblingTokenFields(options.tokensByArtifact, entry.htmlPath)
        }))
      : []
  const derivedTokens = derivedTokensForTurn(options, htmlSiblingManifest)
  const qualityFindings =
    options.target === 'html' || options.target === 'screen'
      ? await readDesignHtmlQualityFindings({
          workspaceRoot: options.workspaceRoot,
          htmlPath: options.basePath,
          designNotesPath: options.designNotesPath,
          siblingScreens: options.target === 'screen' ? screenManifest : htmlSiblingManifest
        })
      : []
  const contextLocations = designSelectedContextLocations({
    targets: options.visibleTargets,
    canvasArtifact: options.boardArtifact
  })
  const prompt = buildDesignTurnPrompt({
    target: options.target,
    mode: options.mode,
    text: options.promptText,
    artifactRelativePath: options.artifactRelativePath,
    workspaceRoot: options.workspaceRoot,
    customPrompt: options.promptState.generationPrompt || undefined,
    designContext: mergeDesignContextWithTokens(options.promptState.designContext, derivedTokens),
    ...(options.designNotesPath ? { designNotesPath: options.designNotesPath } : {}),
    ...(options.basePath ? { basePath: options.basePath } : {}),
    ...(options.htmlElementContext ? { htmlElementContext: options.htmlElementContext } : {}),
    ...(contextLocations.length > 0 ? { contextLocations } : {}),
    ...(options.canvasSnapshot ? { canvasSnapshot: options.canvasSnapshot } : {}),
    canvasDesignSystem: options.designSystem,
    ...(options.projectDesignMdSourceHash ? { projectDesignMdSourceHash: options.projectDesignMdSourceHash } : {}),
    ...(options.htmlFrameContext ? { frameContext: options.htmlFrameContext } : {}),
    ...(options.previousOpErrors?.length ? { previousOpErrors: options.previousOpErrors } : {}),
    ...(options.imageEditReferencePath
      ? { imageEditReferencePath: options.imageEditReferencePath }
      : {}),
    ...(derivedTokens ? { derivedTokens } : {}),
    ...(qualityFindings.length > 0 ? { qualityFindings } : {}),
    ...(htmlSiblingManifest.length > 0 ? { screenManifest: htmlSiblingManifest } : {}),
    ...(options.target === 'screen' && options.selectedFrame ? {
      screenName: options.selectedFrame.name,
      screenWidth: options.selectedFrame.width,
      screenHeight: options.selectedFrame.height,
      ...(options.htmlFrameContext?.sizeMode ? { screenSizeMode: options.htmlFrameContext.sizeMode } : {}),
      screenManifest
    } : {})
  })
  return { prompt, promptState: options.promptState }
}
