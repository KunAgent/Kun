import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssistantMailboxStatus } from '@shared/assistant-mailbox'

/** A join request waits on the user: surface it like a phone pairing request (notification and badge). */
export function useAssistantAttention(status: AssistantMailboxStatus | null): void {
  const { t } = useTranslation('common')
  const waiting = status?.enrollments.filter((enrollment) => enrollment.requests.length > 0) ?? []
  const first = waiting[0]
  const key = first?.requests[0]?.requestId ?? ''
  useEffect(() => {
    const request = window.kunGui?.requestUserAttention
    if (!request || !first || !key) return
    void request({
      key: `assistant-join:${key}`,
      title: t('assistantMailboxAttentionTitle', { name: first.name }),
      body: t('assistantMailboxAttentionBody'),
      badge: waiting.length
    }).catch(() => undefined)
  }, [key, waiting.length]) // eslint-disable-line react-hooks/exhaustive-deps
}
