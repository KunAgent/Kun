import type { LucideIcon } from 'lucide-react'
import { MessageSquare, QrCode, Settings } from 'lucide-react'
import type {
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImSettingsV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawModel
} from '@shared/app-settings'

export type ClawImDialogMode = 'add' | 'edit'
export type ClawConnectionMode = 'official-install-qr'
export type ClawInstallTarget = 'feishu' | 'lark'
export type ClawAgentTab = 'identity' | 'personality' | 'userContext' | 'replyRules'
export type ClawOfficialInstallProvider = 'feishu'
export type ClawDialogStep = 'defaults' | 'prompt' | 'connection'
export type ClawManageStage = 'select' | 'configure'

export type ClawAddImDialogProps = {
  mode: ClawImDialogMode
  initialProvider?: ClawImProvider
  initialChannelId?: string
  channels: ClawImChannelV1[]
  onClose: () => void
  onAddProvider: (
    provider: ClawImProvider,
    agentProfile: ClawImAgentProfileV1,
    platformCredential?: ClawImPlatformCredentialV1,
    options?: {
      channelId?: string
      model?: ClawModel
      workspaceRoot?: string
      enabled?: boolean
      im?: Partial<ClawImSettingsV1>
    }
  ) => Promise<void>
  t: (k: string, opts?: Record<string, unknown>) => string
}

export type ClawAddProviderOption = {
  id: ClawImProvider
  label: string
  toneClass: string
  connectionMode: ClawConnectionMode
  credentialHints?: string[]
  guideStepKeys: string[]
}

export type ClawInstallQrState = {
  status: 'idle' | 'loading' | 'showing' | 'success' | 'error'
  url: string
  deviceCode: string
  timeLeft: number
  error: string
}

export const CLAW_ADD_PROVIDER_OPTIONS: ClawAddProviderOption[] = [
  {
    id: 'feishu',
    label: 'Feishu / Lark',
    toneClass: 'bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200',
    connectionMode: 'official-install-qr',
    credentialHints: ['feishu.appId', 'feishu.appSecret'],
    guideStepKeys: [
      'clawAddImGuideFeishuOfficial1',
      'clawAddImGuideFeishuOfficial2',
      'clawAddImGuideFeishuOfficial3'
    ]
  }
]

export const CLAW_AGENT_TABS: Array<{
  id: ClawAgentTab
  labelKey: string
  helperKey: string
  placeholderKey: string
}> = [
  {
    id: 'identity',
    labelKey: 'clawAddImTabIdentity',
    helperKey: 'clawAddImIdentityHelp',
    placeholderKey: 'clawAddImIdentityPlaceholder'
  },
  {
    id: 'personality',
    labelKey: 'clawAddImTabPersonality',
    helperKey: 'clawAddImPersonalityHelp',
    placeholderKey: 'clawAddImPersonalityPlaceholder'
  },
  {
    id: 'userContext',
    labelKey: 'clawAddImTabAboutYou',
    helperKey: 'clawAddImAboutHelp',
    placeholderKey: 'clawAddImAboutPlaceholder'
  },
  {
    id: 'replyRules',
    labelKey: 'clawAddImTabReplyRules',
    helperKey: 'clawAddImReplyRulesHelp',
    placeholderKey: 'clawAddImReplyRulesPlaceholder'
  }
]

export const DEFAULT_CLAW_WORKSPACE_ROOT = '~/.deepseekgui/claw'

export const CLAW_DIALOG_STEPS: Array<{
  id: ClawDialogStep
  labelKey: string
  descriptionKey: string
  icon: LucideIcon
}> = [
  {
    id: 'defaults',
    labelKey: 'clawAddImSectionDefaults',
    descriptionKey: 'clawAddImSectionDefaultsDesc',
    icon: Settings
  },
  {
    id: 'prompt',
    labelKey: 'clawAddImSectionPrompt',
    descriptionKey: 'clawAddImSectionPromptDesc',
    icon: MessageSquare
  },
  {
    id: 'connection',
    labelKey: 'clawAddImSectionConnect',
    descriptionKey: 'clawAddImSectionConnectDesc',
    icon: QrCode
  }
]

export function clawConnectionListLabelKey(mode: ClawConnectionMode): string {
  void mode
  return 'clawAddImOfficialQrBinding'
}

export function clawConnectionStatusKey(mode: ClawConnectionMode): string {
  void mode
  return 'clawAddImReadyForOfficialQrStatus'
}

export function clawConnectionModeLabelKey(mode: ClawConnectionMode): string {
  void mode
  return 'clawAddImModeOfficialQr'
}

export function clawConnectionHintKey(mode: ClawConnectionMode): string {
  void mode
  return 'clawAddImOfficialQrHint'
}

export function clawPayloadQrTitleKey(mode: ClawConnectionMode): string {
  void mode
  return 'clawAddImOfficialQrTitle'
}

export function clawCredentialLabelKey(hint: string): string {
  switch (hint) {
    case 'feishu.appId':
      return 'clawAddImCredentialFeishuAppId'
    case 'feishu.appSecret':
      return 'clawAddImCredentialFeishuAppSecret'
    default:
      return 'clawAddImCredentialGeneric'
  }
}

export function copyTextFallback(text: string): boolean {
  const textarea = document.createElement('textarea')
  const selection = document.getSelection()
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (selection && selectedRange) {
    selection.removeAllRanges()
    selection.addRange(selectedRange)
  }
  return ok
}

export function isOfficialInstallProvider(
  provider: ClawImProvider
): provider is ClawOfficialInstallProvider {
  return provider === 'feishu'
}

export function clawInstallTargetLabel(
  t: (k: string, opts?: Record<string, unknown>) => string,
  target: ClawInstallTarget
): string {
  return target === 'lark' ? t('clawAddImTargetLark') : t('clawAddImTargetFeishu')
}

export function clawDefaultAgentName(target: ClawInstallTarget): string {
  return target === 'lark' ? 'Lark Agent' : 'Feishu Agent'
}

export function clawDefaultChannelWorkspacePreview(
  provider: ClawImProvider,
  target: ClawInstallTarget,
  platformCredential?: ClawImPlatformCredentialV1,
  channelId?: string
): string {
  const domain = sanitizeWorkspaceSegment(
    platformCredential?.domain || target,
    target === 'lark' ? 'lark' : 'feishu'
  )
  const workspaceId = platformCredential?.appId?.trim()
    ? sanitizeWorkspaceSegment(platformCredential.appId, 'app')
    : channelId?.trim()
      ? sanitizeWorkspaceSegment(channelId, 'channel')
      : '<appId-or-channel-id>'
  return `${DEFAULT_CLAW_WORKSPACE_ROOT}/${provider}/${domain}/${workspaceId}`
}

function sanitizeWorkspaceSegment(raw: string | null | undefined, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return fallback
  const sanitized = value
    .replace(/[\\/]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || fallback
}
