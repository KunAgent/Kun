import { createHash, randomBytes } from 'node:crypto'
import {
  BrowserWindow,
  WebContentsView,
  type Rectangle
} from 'electron'
import type {
  BrowserUseActionConsentRequest,
  BrowserUseAuditEntry,
  BrowserUseBudgetState,
  BrowserUseMode,
  BrowserUseOriginConsentRequest,
  BrowserUseRect,
  BrowserUseViewState
} from '../../shared/browser-use'
import type { KunBrowserUseSettingsV1 } from '../../shared/app-settings'
import {
  BrowserUseToolResult,
  type BrowserUseActionInput as BrowserUseAction,
  type BrowserUseSnapshot,
  type BrowserUseSnapshotNode,
  type BrowserUseToolResult as BrowserUseResult
} from '../../../kun/src/contracts/browser-use.js'
import {
  hardenedRemoteWebPreferences
} from '../browser-security/web-contents-hardening'
import {
  BrowserUsePolicyProxy,
  type BrowserUsePolicyProxy as BrowserUsePolicyProxyType
} from './network-policy'

export const ORIGIN_DECISION_TIMEOUT_MS = 60_000
export const ACTION_DECISION_TIMEOUT_MS = 30_000
export const MOUNT_TIMEOUT_MS = 15_000
export const PROXY_CONFIGURATION_TIMEOUT_MS = 15_000
export const NAVIGATION_TIMEOUT_MS = 45_000
export const STRUCTURED_OBSERVATION_TIMEOUT_MS = 10_000
export const PREPARED_ACTION_TTL_MS = 30_000
export const MAX_AUDIT_ENTRIES = 2_000
export const MAX_BROWSER_USE_SESSIONS = 4
export const BACKGROUND_VIEW_BOUNDS: Rectangle = {
  x: 0,
  y: 0,
  width: 1280,
  height: 800
}
export const DOCUMENT_INVALIDATION_EVENTS = new Set(['DOM.documentUpdated'])
export const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem'
])
export const SENSITIVE_AUTOCOMPLETE = /(?:^|\s)(?:cc-|current-password|new-password|one-time-code|webauthn|username|email)/i
export const SENSITIVE_FIELD = /(?:pass(?:word|code)?|passwd|username|user.?name|e-?mail|api.?key|secret|access.?token|otp|one.?time|2fa|mfa|auth.?code|verification.?code|captcha|human.?verification|card.?number|credit.?card|cvv|cvc|security.?code|ssn|social.?security|file.?upload|密码|口令|验证码|银行卡|信用卡|用户名|邮箱|パスワード|認証コード|カード番号|비밀번호|인증.?코드|카드.?번호)/i
const EXTERNAL_EFFECT_PATTERNS = [
  /\b(?:buy|pay|purchase|place order|confirm order|checkout|transfer|withdraw|send|submit|post|publish|delete|remove|confirm|save|apply|create|update|authorize|allow|grant|subscribe|unsubscribe|follow|book|reserve|bid|vote|sign[ -]?(?:in|up|out)|log[ -]?(?:in|out)|register|download|upload|change password|reset password|delete account|close account)\b/i,
  /(?:购买|支付|付款|下单|结账|转账|汇款|提现|发送|提交|发布|删除|移除|注销|确认|保存|申请|创建|更新|授权|允许|订阅|取消订阅|关注|预订|预约|投票|登录|注册|退出登录|上传|下载)/,
  /(?:ログイン|サインイン|登録|ログアウト|購入|支払|注文|決済|送信|提出|投稿|公開|削除|退会|確認|保存|申請|作成|更新|許可|承認|購読|予約|アップロード|ダウンロード)/i,
  /(?:로그인|가입|로그아웃|구매|결제|주문|송금|출금|전송|제출|게시|발행|삭제|탈퇴|확인|저장|신청|생성|업데이트|허용|승인|구독|예약|업로드|다운로드)/i,
  /\b(?:comprar|pagar|enviar|publicar|eliminar|borrar|confirmar|guardar|autorizar|suscribirse|acheter|payer|envoyer|publier|supprimer|confirmer|enregistrer|autoriser|kaufen|bezahlen|senden|veröffentlichen|löschen|bestätigen|speichern|разместить|купить|оплатить|отправить|удалить|подтвердить|сохранить)\b/i
]
const LOW_RISK_CONTROL_PATTERNS = [
  /^(?:expand|collapse|show (?:more|less)|menu|open menu)$/i,
  /^(?:展开|收起|显示更多|显示更少|菜单)$/,
  /^(?:展開|折りたたむ|メニュー)$/,
  /^(?:펼치기|접기|메뉴)$/
]
export type BrowserUseManagerTimeouts = {
  proxyConfigurationMs: number
  navigationMs: number
  structuredObservationMs: number
}

export type BrowserUseManagerOptions = {
  settings: () => KunBrowserUseSettingsV1
  now?: () => Date
  timeouts?: Partial<BrowserUseManagerTimeouts>
  createView?: (partition: string) => WebContentsView
  createProxy?: (
    mode: BrowserUseMode,
    exactLocalOrigin: string | undefined,
    onPolicyEvent: (event: {
      outcome: 'allowed' | 'blocked'
      sanitizedUrl: string
      code?: string
    }) => void
  ) => BrowserUsePolicyProxy
  onState?: (state: BrowserUseViewState) => void
  onAudit?: (entry: BrowserUseAuditEntry) => void | Promise<void>
}

export type BrowserMount = {
  window: BrowserWindow
  bounds: Rectangle
  visible: boolean
  supervisionActive: boolean
  onRendererLost?: () => void
}

export type BrowserTarget = {
  ref: string
  tabId: string
  documentGeneration: number
  backendNodeId: number
  role: string
  name: string
  sensitive: boolean
  disabled: boolean
  rect: BrowserUseRect
  fingerprint: string
}

export type PreparedAction = {
  id: string
  action: Extract<BrowserUseAction, { action: 'click' | 'type' | 'select' | 'press' }>
  target: BrowserTarget
  origin: string
  createdAt: number
  expiresAt: number
  used: boolean
}

export type PendingDecision = {
  id: string
  resolve: (decision: BrowserDecision) => void
  timer: ReturnType<typeof setTimeout>
}

export type BrowserDecision = 'allow-once' | 'deny' | 'expired' | 'cancelled'

export type BrowserTab = {
  id: string
  view: WebContentsView
  loading: boolean
  error?: string
}

export type TurnBudget = {
  observationUsed: number
  interactionUsed: number
}

export type BrowserSessionEntry = {
  id: string
  threadId: string
  mode: BrowserUseMode
  partition: string
  createdAt: number
  lastActivityAt: number
  lifecycle: BrowserUseViewState['lifecycle']
  reason?: string
  controlOwner: BrowserUseViewState['controlOwner']
  mount?: BrowserMount
  mountWaiters: Set<() => void>
  proxy?: BrowserUsePolicyProxy
  proxyUrl?: string
  proxyStart?: Promise<void>
  exactLocalOrigin?: string
  grants: Set<string>
  tabs: Map<string, BrowserTab>
  activeTabId?: string
  documentGeneration: number
  refs: Map<string, BrowserTarget>
  prepared: Map<string, PreparedAction>
  pendingOrigin?: BrowserUseOriginConsentRequest
  pendingAction?: BrowserUseActionConsentRequest
  pendingOriginDecision?: PendingDecision
  pendingActionDecision?: PendingDecision
  turnBudgets: Map<string, TurnBudget>
  activeTurnId?: string
  idleTimer?: ReturnType<typeof setTimeout>
  activeOperations: Set<AbortController>
  operationQueue: Promise<void>
  stopping: boolean
  agentInputDispatchActive: boolean
}

export type AxValue = {
  value?: unknown
}

export type AxProperty = {
  name?: string
  value?: AxValue
}

export type AxNode = {
  ignored?: boolean
  backendDOMNodeId?: number
  role?: AxValue
  name?: AxValue
  value?: AxValue
  properties?: AxProperty[]
}

export type DomDescription = {
  node?: {
    backendNodeId?: number
    localName?: string
    nodeName?: string
    attributes?: string[]
  }
}

export type BoxModelResult = {
  model?: {
    border?: number[]
    content?: number[]
  }
}

export function createBrowserUseView(partition: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: hardenedRemoteWebPreferences(partition)
  })
  view.setBackgroundColor('#ffffff')
  return view
}

export function isInteractionAction(
  action: BrowserUseAction
): action is Extract<BrowserUseAction, { action: 'click' | 'type' | 'select' | 'press' }> {
  return action.action === 'click' ||
    action.action === 'type' ||
    action.action === 'select' ||
    action.action === 'press'
}

export function resultOk(
  code: string,
  message: string,
  entry?: BrowserSessionEntry,
  tabId?: string
): BrowserUseResult {
  return BrowserUseToolResult.parse({
    ok: true,
    code,
    message,
    ...(entry ? { sessionId: entry.id } : {}),
    ...(tabId ?? entry?.activeTabId ? { tabId: tabId ?? entry?.activeTabId } : {})
  })
}

export function resultError(
  code: string,
  message: string,
  entry?: BrowserSessionEntry,
  tabId?: string
): BrowserUseResult {
  return BrowserUseToolResult.parse({
    ok: false,
    code,
    message: message.slice(0, 2048),
    ...(entry ? { sessionId: entry.id } : {}),
    ...(tabId ?? entry?.activeTabId ? { tabId: tabId ?? entry?.activeTabId } : {})
  })
}

export function normalizeBounds(
  input: BrowserUseRect,
  windowBounds: Pick<Rectangle, 'width' | 'height'>,
  zoomFactor: number
): Rectangle {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  const x = clamp(Math.round(input.x * zoom), 0, windowBounds.width)
  const y = clamp(Math.round(input.y * zoom), 0, windowBounds.height)
  return {
    x,
    y,
    width: clamp(Math.round(input.width * zoom), 0, Math.max(0, windowBounds.width - x)),
    height: clamp(Math.round(input.height * zoom), 0, Math.max(0, windowBounds.height - y))
  }
}

export function isVisibleMount(mount: BrowserMount | undefined): boolean {
  return Boolean(
    mount?.visible &&
    mount.supervisionActive &&
    !mount.window.isDestroyed() &&
    mount.bounds.width > 0 &&
    mount.bounds.height > 0
  )
}

export function safeOrigin(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

export function originOnly(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).origin
  } catch {
    return undefined
  }
}

export function pathOnly(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).pathname.slice(0, 1024)
  } catch {
    return undefined
  }
}

export function attributesRecord(raw: string[] | undefined): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {}
  if (!raw) return attributes
  for (let index = 0; index + 1 < raw.length && index < 64; index += 2) {
    attributes[String(raw[index]).toLowerCase().slice(0, 64)] = String(raw[index + 1]).slice(0, 512)
  }
  return attributes
}

export function isSensitiveTarget(
  role: string,
  name: string,
  description: DomDescription,
  attributes: Readonly<Record<string, string>>
): boolean {
  const type = attributes.type?.toLowerCase() ?? ''
  if (type === 'password' || type === 'file' || type === 'hidden') return true
  if (SENSITIVE_AUTOCOMPLETE.test(attributes.autocomplete ?? '')) return true
  const identity = [
    role,
    name,
    description.node?.localName,
    description.node?.nodeName,
    attributes.name,
    attributes.id,
    attributes.placeholder,
    attributes['aria-label']
  ].filter(Boolean).join(' ')
  return SENSITIVE_FIELD.test(identity)
}

export function isForbiddenCommitTarget(name: string, role = ''): boolean {
  const identity = `${role} ${name}`.trim()
  return EXTERNAL_EFFECT_PATTERNS.some((pattern) => pattern.test(identity))
}

export function isLowRiskAutomaticAction(
  action: Extract<BrowserUseAction, { action: 'click' | 'type' | 'select' | 'press' }>,
  target: BrowserTarget
): boolean {
  if (target.sensitive || target.disabled || isForbiddenCommitTarget(target.name, target.role)) {
    return false
  }
  if (action.action !== 'click') return false
  const name = target.name.trim()
  if (!name) return false
  const role = target.role.toLowerCase()
  if (role !== 'button' && role !== 'tab') return false
  return LOW_RISK_CONTROL_PATTERNS.some((pattern) => pattern.test(name))
}

export function isDisabledTarget(
  properties: ReadonlyMap<string, unknown>,
  attributes: Readonly<Record<string, string>>
): boolean {
  return properties.get('disabled') === true ||
    Object.prototype.hasOwnProperty.call(attributes, 'disabled') ||
    attributes['aria-disabled']?.toLowerCase() === 'true'
}

export function axString(value: AxValue | undefined): string {
  return typeof value?.value === 'string' ? value.value : ''
}

export function axProperties(properties: AxProperty[] | undefined): Map<string, unknown> {
  return new Map((properties ?? []).flatMap((property) =>
    property.name ? [[property.name, property.value?.value] as const] : []
  ))
}

export function isNearViewport(rect: BrowserUseRect, bounds: Rectangle | undefined): boolean {
  const width = bounds?.width ?? 1920
  const height = bounds?.height ?? 1080
  const margin = Math.max(width, height)
  return rect.x + rect.width >= -margin &&
    rect.y + rect.height >= -margin &&
    rect.x <= width + margin &&
    rect.y <= height + margin
}

export async function dispatchClick(
  tab: BrowserTab,
  x: number,
  y: number,
  assertActive: () => void
): Promise<void> {
  assertActive()
  await tab.view.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1
  })
  assertActive()
  await tab.view.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1
  })
  assertActive()
}

export async function dispatchKey(
  tab: BrowserTab,
  key: string,
  assertActive: () => void
): Promise<void> {
  assertActive()
  await tab.view.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key
  })
  assertActive()
  await tab.view.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key
  })
  assertActive()
}

export class BrowserUseOperationAbortedError extends Error {
  constructor() {
    super('Browser Use operation was cancelled or invalidated.')
    this.name = 'BrowserUseOperationAbortedError'
  }
}

export class BrowserUseDeadlineError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'BrowserUseDeadlineError'
  }
}

export async function withBrowserUseDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  code: string,
  message: string,
  onTimeout?: () => void
): Promise<T> {
  if (signal.aborted) throw new BrowserUseOperationAbortedError()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new BrowserUseOperationAbortedError())
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new BrowserUseDeadlineError(code, message))
    }, timeoutMs)
  })
  operation.catch(() => undefined)
  try {
    return await Promise.race([operation, deadline])
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export function browserUseErrorCode(error: unknown, fallback: string): string {
  return error instanceof BrowserUseDeadlineError ? error.code : fallback
}

export function assertBrowserUseOperationActive(
  currentEntry: BrowserSessionEntry | undefined,
  entry: BrowserSessionEntry,
  signal: AbortSignal,
  tab?: BrowserTab,
  documentGeneration?: number
): void {
  if (
    signal.aborted ||
    entry.stopping ||
    currentEntry !== entry ||
    (tab && (entry.tabs.get(tab.id) !== tab || entry.activeTabId !== tab.id)) ||
    (documentGeneration !== undefined && entry.documentGeneration !== documentGeneration)
  ) {
    throw new BrowserUseOperationAbortedError()
  }
}

export async function runSerializedBrowserUseOperation(
  entry: BrowserSessionEntry,
  signal: AbortSignal,
  assertActive: () => void,
  operation: (signal: AbortSignal) => Promise<BrowserUseResult>
): Promise<BrowserUseResult> {
  const previous = entry.operationQueue
  let release: () => void = () => undefined
  const ownTurn = new Promise<void>((resolve) => {
    release = resolve
  })
  entry.operationQueue = previous.catch(() => undefined).then(() => ownTurn)
  try {
    await waitForOperationTurn(previous, signal)
    assertActive()
    return await operation(signal)
  } finally {
    release()
  }
}

async function waitForOperationTurn(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new BrowserUseOperationAbortedError()
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new BrowserUseOperationAbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void previous.catch(() => undefined).then(() => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) reject(new BrowserUseOperationAbortedError())
      else resolve()
    })
  })
}

export function randomToken(): string {
  return randomBytes(24).toString('base64url')
}

export function sanitizePageTitle(value: string): string {
  return value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\b(?:sk|pk|api|token)[-_][A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\b(token|secret|api[_ -]?key)=\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512)
}

export function roundRect(value: number): number {
  return Math.round(value * 100) / 100
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function once<T extends (...args: never[]) => void>(callback: T): T {
  let called = false
  return ((...args: never[]) => {
    if (called) return
    called = true
    callback(...args)
  }) as T
}

export function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason ?? new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function auditDecision(
  decision: BrowserDecision
): 'allowed' | 'denied' | 'expired' | 'cancelled' {
  if (decision === 'allow-once') return 'allowed'
  if (decision === 'deny') return 'denied'
  return decision
}
