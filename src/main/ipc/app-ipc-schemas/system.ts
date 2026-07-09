import { z } from 'zod'
import { DESKTOP_COMMANDS } from '../../../shared/kun-gui-api'
import { GUI_UPDATE_CHANNELS } from '../../../shared/gui-update'
import { SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS, SPEECH_TRANSCRIPTION_MAX_DURATION_MS } from '../../../shared/speech-to-text'
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_CWD_LENGTH,
  TERMINAL_MAX_DATA_WRITE_BYTES,
  TERMINAL_MAX_ROWS,
  TERMINAL_MAX_SESSION_ID_LENGTH
} from '../../../shared/terminal'
import {
  MAX_BODY_BYTES,
  MAX_CHANNEL_TEXT_LENGTH,
  MAX_DEVICE_CODE_LENGTH,
  MAX_ID_LENGTH,
  MAX_NOTIFICATION_BODY_LENGTH,
  MAX_NOTIFICATION_TITLE_LENGTH,
  MAX_URL_LENGTH,
  defaultPathSchema,
  isSafeOpenExternalUrl,
  optionalTrimmedString,
  trimmedString
} from './common'
import {
  clawImProviderSchema,
  clawRunModeSchema,
  localWhisperDownloadSourceSchema,
  localWhisperModelIdSchema,
  modelIdSchema,
  scheduleReasoningEffortSchema,
  speechToTextSettingsSchema
} from './settings'
export const speechTranscribePayloadSchema = z
  .object({
    audioBase64: z.string().min(1).max(SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS),
    mimeType: trimmedString(64),
    durationMs: z.number().int().positive().max(SPEECH_TRANSCRIPTION_MAX_DURATION_MS).optional(),
    speechToText: speechToTextSettingsSchema.optional()
  })
  .strict()

export const localWhisperModelIdPayloadSchema = localWhisperModelIdSchema.optional()
export const localWhisperDownloadPayloadSchema = z
  .object({
    modelId: localWhisperModelIdSchema.optional(),
    sourceId: localWhisperDownloadSourceSchema.optional()
  })
  .strict()
export const localWhisperSourceStatusPayloadSchema = z
  .object({
    modelId: localWhisperModelIdSchema.optional()
  })
  .strict()

export const shellOpenExternalUrlSchema = trimmedString(MAX_URL_LENGTH).refine(
  isSafeOpenExternalUrl,
  { message: 'Only http, https, and mailto URLs are allowed.' }
)

export const notificationPayloadSchema = z
  .object({
    threadId: optionalTrimmedString(MAX_ID_LENGTH),
    title: trimmedString(MAX_NOTIFICATION_TITLE_LENGTH),
    body: trimmedString(MAX_NOTIFICATION_BODY_LENGTH)
  })
  .strict()

export const guiUpdateChannelSchema = z.enum(GUI_UPDATE_CHANNELS).optional()

export const desktopCommandSchema = z.enum(DESKTOP_COMMANDS)

export const computerUsePermissionKindSchema = z.enum(['accessibility', 'screenRecording'])


export const logErrorPayloadSchema = z
  .object({
    category: trimmedString(128),
    message: trimmedString(2_000),
    detail: z.unknown().optional()
  })
  .strict()

export const clawMirrorPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    direction: z.enum(['user', 'assistant'])
  })
  .strict()

export const clawTaskFromTextPayloadSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    channelId: z.string().trim().min(1).max(MAX_ID_LENGTH).nullable().optional(),
    providerId: z.string().trim().max(64).nullable().optional(),
    modelHint: modelIdSchema.nullable().optional(),
    reasoningEffort: scheduleReasoningEffortSchema.nullable().optional(),
    mode: z.enum(['agent', 'plan']).nullable().optional()
  })
  .strict()

export const scheduleTaskFromTextPayloadSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    workspaceRoot: defaultPathSchema,
    clawChannelId: z.string().trim().min(1).max(MAX_ID_LENGTH).nullable().optional(),
    providerId: z.string().trim().max(64).nullable().optional(),
    modelHint: modelIdSchema.nullable().optional(),
    reasoningEffort: scheduleReasoningEffortSchema.nullable().optional(),
    mode: z.enum(['agent', 'plan']).nullable().optional()
  })
  .strict()

export const clawImInstallPollPayloadSchema = z
  .object({
    provider: clawImProviderSchema,
    deviceCode: trimmedString(MAX_DEVICE_CODE_LENGTH)
  })
  .strict()

export const clawImTelegramTokenPayloadSchema = z
  .object({
    botToken: z.string().trim().min(1),
    allowedChatIds: z.string().trim().optional().default('')
  })
  .strict()

export const sseStartPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    sinceSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    streamId: optionalTrimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const streamIdSchema = trimmedString(MAX_ID_LENGTH)

export const uiPluginIdPayloadSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
  })
  .strict()

export const terminalSessionIdSchema = trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH)

export const terminalCreatePayloadSchema = z
  .object({
    sessionId: trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH),
    cwd: optionalTrimmedString(TERMINAL_MAX_CWD_LENGTH),
    cols: z.number().int().min(1).max(TERMINAL_MAX_COLS).optional(),
    rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS).optional()
  })
  .strict()

export const terminalWritePayloadSchema = z
  .object({
    sessionId: trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH),
    data: z.string().min(1).max(TERMINAL_MAX_DATA_WRITE_BYTES)
  })
  .strict()

export const terminalResizePayloadSchema = z
  .object({
    sessionId: trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH),
    cols: z.number().int().min(1).max(TERMINAL_MAX_COLS).default(TERMINAL_DEFAULT_COLS),
    rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS).default(TERMINAL_DEFAULT_ROWS)
  })
  .strict()
