import './mobile-loading.css'

/** Three-dot wave shared by every phone loading state and the agent typing bubble. */
export function MobileLoadingDots({ className = '' }: { className?: string }) {
  return <span className={`kun-mobile-loading-dots ${className}`.trim()} aria-hidden="true"><i /><i /><i /></span>
}

/** Centered loading state; fades in after a short delay so fast loads do not flash. */
export function MobileLoadingState({ label, className = '' }: { label: string; className?: string }) {
  return <div className={`kun-mobile-loading ${className}`.trim()} role="status" aria-live="polite">
    <MobileLoadingDots />
    <span>{label}</span>
  </div>
}

const CHAT_SKELETON = [
  { side: 'start', lines: ['70%', '45%'] },
  { side: 'end', lines: ['55%'] },
  { side: 'start', lines: ['80%', '62%', '38%'] },
  { side: 'end', lines: ['42%'] }
] as const

/** Bubble-shaped placeholder so the conversation layout is visible while it loads. */
export function MobileChatSkeleton({ label }: { label: string }) {
  return <div className="kun-mobile-chat-skeleton" role="status" aria-live="polite">
    <span className="kun-mobile-visually-hidden">{label}</span>
    {CHAT_SKELETON.map((row, index) => <div key={index} className="kun-mobile-chat-skeleton-row" data-side={row.side}
      aria-hidden="true" style={{ animationDelay: `${index * 60}ms` }}>
      {row.side === 'start' ? <span className="kun-mobile-chat-skeleton-avatar" /> : null}
      <span className="kun-mobile-chat-skeleton-bubble">
        {row.lines.map((width, line) => <span key={line} className="kun-mobile-shimmer" style={{ width }} />)}
      </span>
    </div>)}
  </div>
}
