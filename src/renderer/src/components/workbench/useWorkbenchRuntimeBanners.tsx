import type { ReactElement } from 'react'
import type { KunRuntimeStatusPayload } from '@shared/kun-gui-api'
import { RuntimeBanner } from '../RuntimeBanner'
import {
  resolveWriteRuntimeBannerMessage,
  type RuntimeConnectionLike
} from '../../lib/write-runtime-banner'
import { shouldSuppressRuntimeErrorBanner } from '../../lib/runtime-banner-visibility'

type UseWorkbenchRuntimeBannersInput = {
  runtimeStatus: KunRuntimeStatusPayload | null
  runtimeConnection: RuntimeConnectionLike
  runtimeLogPath: string
  runtimeError: string | null
  runtimeErrorDetail?: string | null
  stageInsetClass: string
  runtimeActionNeedsConnection: string
  t: (key: string) => string
  onOpenSettings: () => void
  onRetryConnection: () => void
}

export function shouldShowConversationRuntimeBanner(
  visibleRuntimeError: string | null | undefined
): visibleRuntimeError is string {
  return Boolean(visibleRuntimeError)
}

export function useWorkbenchRuntimeBanners({
  runtimeStatus,
  runtimeConnection,
  runtimeLogPath,
  runtimeError,
  runtimeErrorDetail,
  stageInsetClass,
  runtimeActionNeedsConnection,
  t,
  onOpenSettings,
  onRetryConnection
}: UseWorkbenchRuntimeBannersInput): {
  writeRuntimeBanner: ReactElement | null
  conversationRuntimeBanner: ReactElement | null
} {
  const runtimeErrorSuppressed = shouldSuppressRuntimeErrorBanner(runtimeStatus)
  const visibleRuntimeError = runtimeErrorSuppressed ? null : runtimeError
  const visibleRuntimeErrorDetail = runtimeErrorSuppressed ? null : runtimeErrorDetail
  const writeRuntimeBannerMessage = resolveWriteRuntimeBannerMessage({
    runtimeConnection,
    error: visibleRuntimeError,
    runtimeActionNeedsConnection
  })

  const showSettingsAction = /model request failed|temperature|top[_ ]?p|sampling|missing api key|provider/i
    .test(`${visibleRuntimeError ?? ''}\n${visibleRuntimeErrorDetail ?? ''}`)

  const renderRuntimeBanner = (message: string, detail?: string | null): ReactElement => (
    <RuntimeBanner
      message={message}
      detail={detail}
      logPath={runtimeLogPath || null}
      runtimeReady={runtimeConnection === 'ready'}
      showSettingsAction={showSettingsAction}
      stageInsetClass={stageInsetClass}
      onOpenLogDir={
        typeof window !== 'undefined' && typeof window.kunGui?.openLogDir === 'function'
          ? () => window.kunGui.openLogDir()
          : undefined
      }
      onOpenSettings={onOpenSettings}
      onRetryConnection={onRetryConnection}
      t={t}
    />
  )

  return {
    writeRuntimeBanner: writeRuntimeBannerMessage
      ? renderRuntimeBanner(writeRuntimeBannerMessage, visibleRuntimeErrorDetail)
      : null,
    conversationRuntimeBanner:
      shouldShowConversationRuntimeBanner(visibleRuntimeError)
        ? renderRuntimeBanner(visibleRuntimeError, visibleRuntimeErrorDetail)
        : null
  }
}
