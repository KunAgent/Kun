import type { CanvasDocument, ViewBox } from './canvas-types'
import { canvasDocumentKey, loadCanvasDocument } from './canvas-persistence'
import { snapshotCanvas, type CanvasSnapshot } from './canvas-snapshot'
import { loadDesignSystem } from './design-system-persistence'
import { createEmptyDesignSystem, type DesignSystem } from './design-system-types'
import { looksLikeStandaloneImageAssetPrompt } from '../design-image-intent'

/** Workspace subdir for code-mode canvases. Kept out of `.kun-design` so design
 * mode's artifact lister (which enumerates `.kun-design/*`) never sees them. */
export const CODE_CANVAS_DIR = '.kun-canvas'

export function codeCanvasArtifactId(threadId: string): string {
  return `code-${threadId}`
}

export function codeCanvasThreadBaseDir(threadId: string): string {
  return `${CODE_CANVAS_DIR}/${codeCanvasArtifactId(threadId)}`
}

export function codeCanvasErrorKey(threadId: string): string {
  return `code-canvas:${threadId}`
}

export function resolveCodeCanvasWorkspaceRoot(
  threadWorkspaceRoot: string | null | undefined,
  fallbackWorkspaceRoot: string
): string {
  return threadWorkspaceRoot?.trim() || fallbackWorkspaceRoot.trim()
}

const ENGLISH_CODE_CANVAS_TERMS = [
  'whiteboard',
  'code canvas',
  'whiteboard canvas',
  'canvas board',
  'diagram',
  'flowchart',
  'sequence diagram',
  'architecture diagram',
  'dependency graph',
  'state machine',
  'api flow',
  'data flow',
  'schema map',
  'class diagram',
  'component diagram',
  'er diagram',
  'entity relationship diagram',
  'control flow diagram',
  'request flow diagram',
  'service map',
  'module map'
]

const CHINESE_CODE_CANVAS_TERMS = [
  '\\u67b6\\u6784\\u56fe',
  '\\u6d41\\u7a0b\\u56fe',
  '\\u65f6\\u5e8f\\u56fe',
  '\\u6a21\\u5757\\u56fe',
  '\\u4f9d\\u8d56\\u56fe',
  '\\u72b6\\u6001\\u673a\\u56fe',
  '\\u7cfb\\u7edf\\u67b6\\u6784\\u56fe',
  '\\u670d\\u52a1\\u67b6\\u6784\\u56fe',
  '\\u8c03\\u7528\\u94fe\\u8def\\u56fe',
  '\\u8c03\\u7528\\u94fe\\u56fe',
  '\\u8c03\\u7528\\u5173\\u7cfb\\u56fe',
  '\\u6a21\\u5757\\u4f9d\\u8d56\\u56fe',
  '\\u6570\\u636e\\u6d41\\u56fe',
  '\\u63a5\\u53e3\\u6d41\\u7a0b\\u56fe',
  '\\u7c7b\\u56fe',
  '\\u7ec4\\u4ef6\\u56fe',
  '\\u6570\\u636e\\u5e93\\u5173\\u7cfb\\u56fe',
  '[Ee][Rr]\\u56fe',
  '\\u6cf3\\u9053\\u56fe',
  '\\u94fe\\u8def\\u56fe'
]

const CHINESE_CODE_CANVAS_ACTION_TARGETS = [
  '\\u8c03\\u7528(?:\\u94fe\\u8def|\\u94fe)',
  '\\u8c03\\u7528\\u5173\\u7cfb',
  '\\u6a21\\u5757\\u4f9d\\u8d56',
  '\\u7cfb\\u7edf\\u67b6\\u6784',
  '\\u670d\\u52a1\\u67b6\\u6784',
  '\\u63a5\\u53e3\\u6d41\\u7a0b',
  '\\u6570\\u636e\\u5e93\\u5173\\u7cfb'
]

const CODE_CANVAS_INTENT_PATTERNS = [
  new RegExp(`\\b(?:${ENGLISH_CODE_CANVAS_TERMS.join('|')})\\b`, 'i'),
  /\b(?:draw|map|sketch|visuali[sz]e|whiteboard)\b[\s\S]{0,80}\b(?:system architecture|code architecture|module relationships?|module dependencies|service dependencies|call graph|call chain|api flow|request flow|data flow|state machine|schema|database schema)\b/i,
  new RegExp(
    `(?:\\u767d\\u677f|\\u753b(?:\\u4e00\\u4e2a|\\u4e2a)?(?:${CHINESE_CODE_CANVAS_TERMS.join('|')})|(?:${CHINESE_CODE_CANVAS_TERMS.join('|')}))`
  ),
  new RegExp(
    `(?:\\u753b|\\u767d\\u677f|\\u53ef\\u89c6\\u5316|\\u68b3\\u7406)[\\s\\S]{0,40}(?:${CHINESE_CODE_CANVAS_ACTION_TARGETS.join('|')})`
  )
]

const HTML_CANVAS_CODE_PATTERNS = [
  /\bhtml\s+canvas\b/i,
  /\bcanvas\s+(?:api|element|rendering|renderer|context|getcontext|2d|webgl)\b/i,
  /<canvas\b/i,
  /\bCanvasRenderingContext2D\b/
]

const OPEN_WHITEBOARD_ENGLISH_EDIT_VERB =
  /\b(?:add|put|place|move|resize|delete|remove|rename|label|connect|align|arrange|group|ungroup|color|recolor|fill|duplicate|copy|tidy|clean up|make|turn)\b/i
const OPEN_WHITEBOARD_ENGLISH_SHAPE_TARGET =
  /\b(?:box|node|frame|shape|arrow|line|label|card|cluster|group|lane|column|row|sticky|note)\b/i
const OPEN_WHITEBOARD_ENGLISH_DEICTIC_TARGET =
  /\b(?:selected|selection|this|that|it|here|there|these|those)\b/i
const OPEN_WHITEBOARD_ENGLISH_PLACEMENT =
  /\b(?:put|place|add|drop|paste|insert)\b[\s\S]{0,48}\b(?:on|onto|in|into|to)\b[\s\S]{0,24}\b(?:canvas|board|whiteboard|selected|selection|slot|frame|box|here)\b/i

const OPEN_WHITEBOARD_CHINESE_EDIT_VERB =
  /(?:添加|加上|放到|移动|左移|右移|上移|下移|挪|删除|移除|改名|标注|连接|连到|对齐|排列|分组|取消分组|改成|变成|上色|换色|复制|整理)/
const OPEN_WHITEBOARD_CHINESE_SHAPE_TARGET =
  /(?:节点|框|画板|形状|箭头|线|标签|卡片|分组|泳道|列|行|便签|注释)/
const OPEN_WHITEBOARD_CHINESE_DEICTIC_TARGET =
  /(?:选中|这个|那个|这里|那里|它|这些|那些)/
const OPEN_WHITEBOARD_CHINESE_PLACEMENT =
  /(?:放|放到|放进|加到|添加到|贴到|拖到|移到|置入)[\s\S]{0,20}(?:画布|白板|画板|选中|框|这里|这个|里面|上面)/
const OPEN_WHITEBOARD_ENGLISH_EXPORT =
  /(?:\b(?:export|save|download|convert|render)\b[\s\S]{0,40}\b(?:png|svg|image|picture|file|diagram|whiteboard|canvas|this|that|it)\b|\b(?:png|svg|image|picture|file|diagram|whiteboard|canvas|this|that|it)\b[\s\S]{0,40}\b(?:export|save|download|convert|render)\b)/i
const OPEN_WHITEBOARD_ENGLISH_FORMAT_FOLLOW_UP =
  /^(?:(?:please|just)\s+)?(?:(?:give|make|create|generate|produce|send)(?:\s+me)?\s+)?(?:an?\s+)?(?:png|svg)(?:\s+(?:version|copy|file|image))?(?:\s+(?:please|thanks?))?[.!?]*$/i
const OPEN_WHITEBOARD_CHINESE_EXPORT =
  /(?:(?:导出|转成|转换成|保存为|保存成)[\s\S]{0,24}(?:图片|图像|PNG|SVG|文件|架构图|流程图|白板|画布|这个|它)|(?:图片|图像|PNG|SVG|文件|架构图|流程图|白板|画布|这个|它)[\s\S]{0,24}(?:导出|转成|转换成|保存为|保存成))/i
const OPEN_WHITEBOARD_CHINESE_FORMAT_FOLLOW_UP =
  /^(?:(?:请|帮我|给我|就|要|来个)\s*)?(?:(?:生成|导出|保存|做成|转成)\s*)?(?:一张|一个)?\s*(?:PNG|SVG)(?:\s*(?:版本|格式|文件|图片|图像))?(?:\s*(?:就行|即可|谢谢))?[。！？.!?]*$/i
const OPEN_WHITEBOARD_SHORT_EXPORT =
  /^(?:(?:please|just)\s+)?(?:export|save|download)(?:\s+(?:it|this|that|the\s+(?:board|canvas|whiteboard)))?(?:\s+please)?[.!?]*$|^(?:(?:请|帮我|给我)\s*)?(?:把\s*)?(?:(?:它|这个|白板|画布)\s*)?(?:导出|保存|下载)(?:一下)?[。！？.!?]*$/i

export function shouldRouteCodePromptToCanvas(text: string): boolean {
  const value = text.trim()
  return value.length > 0 && CODE_CANVAS_INTENT_PATTERNS.some((pattern) => pattern.test(value))
}

export function shouldRouteOpenCodeWhiteboardPrompt(
  text: string,
  options?: { hasSelection?: boolean }
): boolean {
  const value = text.trim()
  if (!value) return false
  if (HTML_CANVAS_CODE_PATTERNS.some((pattern) => pattern.test(value))) return false
  if (/\bwhiteboard\b/i.test(value) || /白板/.test(value)) return true
  if (looksLikeStandaloneImageAssetPrompt(value)) return true
  if (OPEN_WHITEBOARD_ENGLISH_EXPORT.test(value)) return true
  if (OPEN_WHITEBOARD_ENGLISH_FORMAT_FOLLOW_UP.test(value)) return true
  if (OPEN_WHITEBOARD_CHINESE_EXPORT.test(value)) return true
  if (OPEN_WHITEBOARD_CHINESE_FORMAT_FOLLOW_UP.test(value)) return true
  if (OPEN_WHITEBOARD_SHORT_EXPORT.test(value)) return true
  if (OPEN_WHITEBOARD_ENGLISH_PLACEMENT.test(value)) return true
  if (OPEN_WHITEBOARD_CHINESE_PLACEMENT.test(value)) return true
  const hasSelection = options?.hasSelection === true
  const englishEdit = OPEN_WHITEBOARD_ENGLISH_EDIT_VERB.test(value)
  if (englishEdit && OPEN_WHITEBOARD_ENGLISH_SHAPE_TARGET.test(value)) return true
  if (hasSelection && englishEdit && OPEN_WHITEBOARD_ENGLISH_DEICTIC_TARGET.test(value)) return true
  const chineseEdit = OPEN_WHITEBOARD_CHINESE_EDIT_VERB.test(value)
  if (chineseEdit && OPEN_WHITEBOARD_CHINESE_SHAPE_TARGET.test(value)) return true
  if (hasSelection && chineseEdit && OPEN_WHITEBOARD_CHINESE_DEICTIC_TARGET.test(value)) return true
  return false
}

export function shouldSendPromptToCodeCanvas(options: {
  text: string
  whiteboardOpen: boolean
  hasSelection?: boolean
}): boolean {
  if (shouldRouteCodePromptToCanvas(options.text)) return true
  return options.whiteboardOpen
    ? shouldRouteOpenCodeWhiteboardPrompt(options.text, { hasSelection: options.hasSelection })
    : false
}

export type CodeCanvasComposerRouteInput = {
  route: string
  composerMode: string
  userText: string
  preparedText: string
  preparedDisplayText?: string
  emptyPrompt: string
  whiteboardOpen: boolean
  hasSelection?: boolean
}

export type CodeCanvasComposerRoute = {
  baseText: string
  canvasBrief: string
  displayText: string
}

export function resolveCodeCanvasComposerRoute(
  input: CodeCanvasComposerRouteInput
): CodeCanvasComposerRoute | null {
  if (input.route !== 'chat' || input.composerMode !== 'agent') return null
  const codeCanvasPromptText = input.userText || input.preparedDisplayText || input.preparedText || ''
  if (!shouldSendPromptToCodeCanvas({
    text: codeCanvasPromptText,
    whiteboardOpen: input.whiteboardOpen,
    hasSelection: input.hasSelection
  })) {
    return null
  }
  return {
    baseText: input.preparedText,
    canvasBrief: input.preparedDisplayText ?? (input.userText || input.emptyPrompt),
    displayText: input.preparedDisplayText ?? input.preparedText
  }
}

export type CodeCanvasPromptSnapshotOptions = {
  workspaceRoot: string
  threadId: string
  currentDocument: CanvasDocument
  currentDocumentKey?: string | null
  selectedIds: ReadonlySet<string>
  viewBox: ViewBox
  defaultScreenSize: { width: number; height: number }
  maxShapes?: number
  loadDocument?: typeof loadCanvasDocument
}

export type CodeCanvasPromptDesignSystemOptions = {
  workspaceRoot: string
  threadId: string
  loadSystem?: typeof loadDesignSystem
}

export async function loadCodeCanvasDesignSystemForPrompt(
  options: CodeCanvasPromptDesignSystemOptions
): Promise<DesignSystem> {
  const loadSystem = options.loadSystem ?? loadDesignSystem
  return (
    (await loadSystem(
      options.workspaceRoot,
      codeCanvasThreadBaseDir(options.threadId)
    )) ?? createEmptyDesignSystem()
  )
}

export async function snapshotCodeCanvasForPrompt(
  options: CodeCanvasPromptSnapshotOptions
): Promise<CanvasSnapshot | undefined> {
  const snapshotOptions = (includeViewBox: boolean) => ({
    maxShapes: options.maxShapes ?? 180,
    defaultScreenSize: options.defaultScreenSize,
    projectId: codeCanvasArtifactId(options.threadId),
    ...(includeViewBox ? { viewBox: options.viewBox } : {})
  })
  const expectedDocumentKey = canvasDocumentKey(
    options.workspaceRoot,
    codeCanvasArtifactId(options.threadId),
    CODE_CANVAS_DIR
  )
  const storeMatchesThread = options.currentDocumentKey === expectedDocumentKey
  const selectedIds = storeMatchesThread ? options.selectedIds : new Set<string>()
  if (storeMatchesThread) {
    const currentSnapshot = snapshotCanvas(options.currentDocument, selectedIds, snapshotOptions(true))
    if (currentSnapshot.shapeCount > 0) return currentSnapshot
  }

  const loadDocument = options.loadDocument ?? loadCanvasDocument
  const persisted = await loadDocument(
    options.workspaceRoot,
    codeCanvasArtifactId(options.threadId),
    CODE_CANVAS_DIR
  )
  if (!persisted) return undefined
  const persistedSnapshot = snapshotCanvas(persisted, selectedIds, snapshotOptions(storeMatchesThread))
  return persistedSnapshot.shapeCount > 0 ? persistedSnapshot : undefined
}
