import { useTranslation } from 'react-i18next'

/**
 * Receipt/typing indicator pinned right above the composer, modeled after
 * cumora's TypingRow: a fixed-height row (no layout shift) whose content
 * fades in/out, with three bouncing dots and a live-region label.
 *
 * Priority: active member names > waiting (delivered, not yet received)
 * member names > fallback text > nothing.
 */
export function RoomTypingRow({
  names,
  waitingNames,
  fallback
}: {
  names: string[]
  waitingNames?: string[]
  fallback?: string
}) {
  const { t } = useTranslation('common')
  let body: React.ReactNode = null
  if (names.length === 1) {
    body = (
      <>
        <b className="rooms-typing-name">{names[0]}</b>
        {t('roomsTyping_is')}
      </>
    )
  } else if (names.length === 2) {
    body = (
      <>
        <b className="rooms-typing-name">{names[0]}</b>
        {t('roomsTyping_and')}
        <b className="rooms-typing-name">{names[1]}</b>
        {t('roomsTyping_are')}
      </>
    )
  } else if (names.length >= 3) {
    body = (
      <>
        <b className="rooms-typing-name">{names[0]}</b>
        {t('roomsTyping_sep')}
        <b className="rooms-typing-name">{names[1]}</b>
        {names.length === 3 ? (
          <>
            {t('roomsTyping_and')}
            <b className="rooms-typing-name">{names[2]}</b>
            {t('roomsTyping_are')}
          </>
        ) : (
          <>
            {t('roomsTyping_and')}
            <b className="rooms-typing-name">
              {t('roomsTyping_nMore', { count: names.length - 2 })}
            </b>
            {t('roomsTyping_are')}
          </>
        )}
      </>
    )
  } else if (waitingNames?.length) {
    body = t('roomsReceipt_waiting', {
      name: waitingNames.slice(0, 2).join(t('roomsTyping_sep')),
      count: waitingNames.length
    })
  } else if (fallback) {
    body = fallback
  }
  const visible = Boolean(body)
  return (
    <div
      aria-live="polite"
      className="rooms-typing-row"
      data-visible={visible || undefined}
    >
      {visible ? (
        <>
          <span className="rooms-typing-dots" aria-hidden="true">
            <span className="rooms-typing-dot" />
            <span className="rooms-typing-dot" />
            <span className="rooms-typing-dot" />
          </span>
          <span className="rooms-typing-text">{body}</span>
        </>
      ) : null}
    </div>
  )
}
