import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Check, ChevronDown, MessageCircle, UserRound, UsersRound } from 'lucide-react'
import { expertsApi } from '@shared/seam/api'

export type ConversationModeSelection =
  | { kind: 'normal' }
  | { kind: 'expert'; targetKind: 'expert' | 'team'; targetId: string; label: string }

type ExpertListItem = { id: string; displayName: string }
type ActivationSnapshot = { activeExpertIds: string[]; activeTeamIds: string[] }
export type ActiveExpertOption = { id: string; label: string; kind: 'expert' | 'team' }

export function buildActiveExpertOptions(
  experts: readonly ExpertListItem[],
  teams: readonly ExpertListItem[],
  activation: ActivationSnapshot
): ActiveExpertOption[] {
  const expertMap = new Map(experts.map((item) => [item.id, item]))
  const teamMap = new Map(teams.map((item) => [item.id, item]))
  return [
    ...activation.activeExpertIds.slice(-5).flatMap((id) => {
      const item = expertMap.get(id)
      return item ? [{ id, label: item.displayName, kind: 'expert' as const }] : []
    }),
    ...activation.activeTeamIds.slice(-5).flatMap((id) => {
      const item = teamMap.get(id)
      return item ? [{ id, label: item.displayName, kind: 'team' as const }] : []
    })
  ]
}

export function FloatingComposerConversationModePicker({
  value,
  disabled = false,
  onChange
}: {
  value: ConversationModeSelection
  disabled?: boolean
  onChange: (value: ConversationModeSelection) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ActiveExpertOption[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void expertsApi.list().then((result) => {
      if (cancelled) return
      const activation = (result.activation as ActivationSnapshot | undefined) ?? {
        activeExpertIds: [], activeTeamIds: []
      }
      setOptions(buildActiveExpertOptions(
        (result.experts as ExpertListItem[] | undefined) ?? [],
        (result.teams as ExpertListItem[] | undefined) ?? [],
        activation
      ))
      setError(null)
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [])

  const selected = useMemo(
    () => value.kind === 'expert' ? options.find((option) => option.id === value.targetId) : undefined,
    [options, value]
  )
  const Icon = value.kind === 'normal' ? MessageCircle : selected?.kind === 'team' ? UsersRound : UserRound
  const label = value.kind === 'normal' ? '普通模式' : selected?.label ?? value.label

  return (
    <div className="ds-no-drag relative inline-flex shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-7 max-w-[180px] items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card/72 px-2.5 py-0.5 text-[12.5px] font-semibold text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-55"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="对话模式"
        title={error ?? `对话模式：${label}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      </button>
      {open ? (
        <div role="menu" className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg border border-ds-border bg-ds-card p-1.5 shadow-xl">
          <ModeRow
            label="普通模式"
            selected={value.kind === 'normal'}
            icon={<MessageCircle className="h-4 w-4" />}
            onClick={() => { onChange({ kind: 'normal' }); setOpen(false) }}
          />
          {options.length > 0 ? <div className="my-1 h-px bg-ds-border-muted" /> : null}
          {options.map((option) => (
            <ModeRow
              key={`${option.kind}:${option.id}`}
              label={option.label}
              selected={value.kind === 'expert' && value.targetId === option.id}
              icon={option.kind === 'team' ? <UsersRound className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
              onClick={() => {
                onChange({ kind: 'expert', targetKind: option.kind, targetId: option.id, label: option.label })
                setOpen(false)
              }}
            />
          ))}
          {options.length === 0 ? (
            <div className="px-2 py-2 text-[12px] text-ds-muted">暂无已激活的专家或专家团</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ModeRow({ label, selected, icon, onClick }: {
  label: string
  selected: boolean
  icon: ReactElement
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition ${selected ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
    </button>
  )
}
