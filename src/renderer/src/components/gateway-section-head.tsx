import type { ReactElement, ReactNode } from 'react'

/** A gateway section's title line: what it is, one sentence on why, and its actions. */
export function GatewaySectionHead({ title, badge, description, actions }: {
  title: string
  badge?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}): ReactElement {
  return <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-2 px-1">
    <div className="min-w-0 flex-1">
      <h3 className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ds-ink">{title}{badge}</h3>
      {description ? <p className="mt-0.5 max-w-[48rem] text-[12px] leading-5 text-ds-muted">{description}</p> : null}
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
  </div>
}
