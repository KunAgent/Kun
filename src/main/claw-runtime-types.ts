import type {
  AppSettingsV1,
  ClawGeneratedFileV1,
  ClawImChannelV1,
  ClawRunMode,
  ScheduleReasoningEffort,
  ScheduleTaskFromTextResult
} from '../shared/app-settings'
import type { JsonSettingsStore } from './settings-store'
import type { TelegramRuntime } from './telegram-runtime'

export type RuntimeRequestResult = { ok: boolean; status: number; body: string }

export type RuntimeRequestFn = (
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<RuntimeRequestResult>

export type ClawRuntimeDeps = {
  createPersonalIm?: () => import('./personal-agent-im-service').PersonalAgentImService
  store: JsonSettingsStore
  runtimeRequest: RuntimeRequestFn
  logError: (category: string, message: string, detail?: unknown) => void
  notifyChannelActivity?: (payload: { channelId: string; threadId: string }) => void
  sendWeixinBridgeMessage?: (options: {
    accountId: string
    to: string
    text?: string
    files?: readonly { path: string; fileName: string }[]
  }) => Promise<{ ok: true; messageId: string } | { ok: false; message: string }>
  /** WeChat owner (`ilink_user_id`) for a bridge account; '' when unknown. */
  resolveWeixinAccountUserId?: (accountId: string) => Promise<string>
  /** Telegram long-polling runtime. Absent when no Telegram channel is configured. */
  telegramRuntime?: TelegramRuntime
  createScheduledTaskFromText?: (
    text: string,
    options?: {
      workspaceRoot?: string | null
      clawChannelId?: string | null
      providerId?: string | null
      modelHint?: string | null
      reasoningEffort?: ScheduleReasoningEffort | null
      mode?: ClawRunMode | null
    }
  ) => Promise<ScheduleTaskFromTextResult>
}

export type ThreadRecordJson = {
  id: string
  title?: string
  status?: string
  workspace?: string
  createdAt?: string
  updatedAt?: string
}

export type TurnRecordJson = {
  id: string
  status?: string
  error?: string | null
  items?: TurnItemJson[]
}

export type TurnItemJson = {
  kind: string
  turnId?: string
  toolName?: string
  toolKind?: string
  output?: unknown
  isError?: boolean | null
  text?: string | null
  summary?: string
  detail?: string | null
}

export type ThreadDetailJson = {
  thread?: ThreadRecordJson
  id?: string
  status?: string
  turns?: TurnRecordJson[]
  items?: TurnItemJson[]
}

export type RunPromptOptions = {
  prompt: string
  displayText?: string
  title: string
  workspaceRoot: string
  model: string
  mode: ClawRunMode
  waitForResult: boolean
  responseTimeoutMs: number
  source: 'task' | 'im'
  providerId?: string
  threadId?: string
  channel?: ClawImChannelV1
  onTurnStarted?: (payload: { threadId: string; turnId: string }) => Promise<void> | void
}
