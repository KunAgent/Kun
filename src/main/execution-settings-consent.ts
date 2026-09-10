import { randomBytes } from 'node:crypto'
import type {
  AppSettingsPatch,
  AppSettingsV1,
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../shared/app-settings'
import {
  approvalReviewSelectionEquals,
  type ApprovalReviewModelSelection
} from '../../kun/src/contracts/approval-review-config.js'

export type KunExecutionSecuritySettings = {
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer: ApprovalReviewer
  approvalReview: ApprovalReviewModelSelection
}

export type KunExecutionSettingsChange = {
  current: KunExecutionSecuritySettings
  next: KunExecutionSecuritySettings
}

export type KunExecutionSettingsConsentAction = KunExecutionSettingsChange & {
  senderId: number
  senderProcessId: number
  senderRoutingId: number
}

type ConsentRecord = {
  actionKey: string
  expiresAt: number
}

const CONSENT_LIFETIME_MS = 30_000
const MAX_PENDING_CONSENTS = 32

/**
 * Detect a renderer request that would change Kun's approval/sandbox boundary.
 * Full settings snapshots are common, so equal values are deliberately ignored.
 */
export function kunExecutionSettingsChange(
  current: AppSettingsV1,
  patch: AppSettingsPatch
): KunExecutionSettingsChange | undefined {
  const kunPatch = patch.agents?.kun
  if (!kunPatch || (
    !Object.prototype.hasOwnProperty.call(kunPatch, 'approvalPolicy') &&
    !Object.prototype.hasOwnProperty.call(kunPatch, 'sandboxMode') &&
    !Object.prototype.hasOwnProperty.call(kunPatch, 'approvalReviewer') &&
    !Object.prototype.hasOwnProperty.call(kunPatch, 'approvalReview')
  )) return undefined

  const currentSettings: KunExecutionSecuritySettings = {
    approvalPolicy: current.agents.kun.approvalPolicy,
    sandboxMode: current.agents.kun.sandboxMode,
    approvalReviewer: current.agents.kun.approvalReviewer,
    approvalReview: current.agents.kun.approvalReview
  }
  const next: KunExecutionSecuritySettings = {
    approvalPolicy: kunPatch.approvalPolicy ?? currentSettings.approvalPolicy,
    sandboxMode: kunPatch.sandboxMode ?? currentSettings.sandboxMode,
    approvalReviewer: kunPatch.approvalReviewer ?? currentSettings.approvalReviewer,
    approvalReview: kunPatch.approvalReview ?? currentSettings.approvalReview
  }
  return executionSettingsEqual(currentSettings, next)
    ? undefined
    : { current: currentSettings, next }
}

export function executionSettingsEqual(
  left: KunExecutionSecuritySettings,
  right: KunExecutionSecuritySettings
): boolean {
  return (
    left.approvalPolicy === right.approvalPolicy &&
    left.sandboxMode === right.sandboxMode &&
    left.approvalReviewer === right.approvalReviewer &&
    approvalReviewSelectionEquals(left.approvalReview, right.approvalReview)
  )
}

/**
 * Main-only, action-bound, one-shot consent. The opaque token never crosses
 * preload; it makes the native decision a required input to the persistence
 * call instead of treating a renderer settings payload as authorization.
 */
export class KunExecutionSettingsConsentService {
  private readonly pending = new Map<string, ConsentRecord>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly randomToken: () => string = () => randomBytes(32).toString('base64url')
  ) {}

  issue(action: KunExecutionSettingsConsentAction): string {
    const now = this.now()
    this.prune(now)
    if (this.pending.size >= MAX_PENDING_CONSENTS) {
      throw new Error('Too many pending execution-settings consents.')
    }
    const token = this.randomToken()
    this.pending.set(token, {
      actionKey: actionKey(action),
      expiresAt: now + CONSENT_LIFETIME_MS
    })
    return token
  }

  consume(token: string, action: KunExecutionSettingsConsentAction): boolean {
    const record = this.pending.get(token)
    // A presented token is consumed even when its binding is wrong.
    this.pending.delete(token)
    if (!record || record.expiresAt <= this.now()) return false
    return record.actionKey === actionKey(action)
  }

  private prune(now: number): void {
    for (const [token, record] of this.pending) {
      if (record.expiresAt <= now) this.pending.delete(token)
    }
  }
}

function actionKey(action: KunExecutionSettingsConsentAction): string {
  return JSON.stringify([
    action.current.approvalPolicy,
    action.current.sandboxMode,
    action.current.approvalReviewer,
    action.current.approvalReview,
    action.next.approvalPolicy,
    action.next.sandboxMode,
    action.next.approvalReviewer,
    action.next.approvalReview,
    action.senderId,
    action.senderProcessId,
    action.senderRoutingId
  ])
}
