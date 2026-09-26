import { useMemo, type ReactElement } from 'react'
import { CheckCircle2, CircleDashed, Loader2, Sparkles, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { useChatStore } from '../../../store/chat-store'
import { isPaperToolName, paperListFromToolItem } from '../../../agent/paper-list-adapter'
import type { ChatBlock } from '../../../agent/types'
import { PaperListCard } from '../../chat/PaperListCard'
import type { RendererPaperList } from '../../../agent/paper-list-adapter'

type ToolRow = { id: string; toolName: string; status: string; query?: string }

function toolQuery(detail: string | undefined): string | undefined {
  if (!detail) return undefined
  try {
    const parsed = JSON.parse(detail) as { query?: unknown; seed_id?: unknown }
    const value = parsed.query ?? parsed.seed_id
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined
  } catch {
    return undefined
  }
}

function paperToolRows(blocks: ChatBlock[]): ToolRow[] {
  const rows: ToolRow[] = []
  for (const block of blocks) {
    if (block.kind !== 'tool') continue
    const toolName = typeof block.meta?.toolName === 'string' ? block.meta.toolName : ''
    if (!isPaperToolName(toolName)) continue
    rows.push({ id: block.id, toolName, status: block.status, query: toolQuery(block.detail) })
  }
  return rows
}

function latestPaperList(blocks: ChatBlock[]): RendererPaperList | null {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block.kind === 'paper-list') return block.list
    if (block.kind === 'tool') {
      const list = paperListFromToolItem({
        kind: 'tool_result',
        status: block.status === 'success' ? 'completed' : block.status,
        toolName: typeof block.meta?.toolName === 'string' ? block.meta.toolName : undefined,
        meta: block.meta
      })
      if (list) return list
    }
  }
  return null
}

/**
 * "Agent 检索" tab (plan P1.4): after the query is handed to the paper
 * assistant, this pane shows the run's paper-tool progress live and ends with
 * the same paper-list card that lands in the chat.
 */
export function PaperAgentSearchPane({ workspaceRoot }: { workspaceRoot: string }): ReactElement {
  const { t } = useTranslation('common')
  const agentSearch = usePaperModeStore((s) => s.discover.agentSearch)
  const blocks = useChatStore((s) => s.blocks)
  const busy = useChatStore((s) => s.busy)

  const runBlocks = useMemo(
    () => blocks.slice(agentSearch?.anchorIndex ?? 0),
    [blocks, agentSearch?.anchorIndex]
  )
  const rows = useMemo(() => paperToolRows(runBlocks), [runBlocks])
  const list = useMemo(() => latestPaperList(runBlocks), [runBlocks])

  if (!agentSearch) {
    return (
      <div className="mt-10 text-center">
        <Sparkles className="mx-auto h-5 w-5 text-ds-faint" strokeWidth={1.8} />
        <p className="mt-2 text-[12.5px] text-ds-faint">{t('writePaperAgentTabEmpty')}</p>
      </div>
    )
  }

  const running = busy && !list
  return (
    <div className="mt-5">
      <div className="rounded-xl border border-ds-border-muted bg-ds-card">
        <div className="flex items-center gap-2 border-b border-ds-border-muted px-3.5 py-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ds-ink">{agentSearch.query}</p>
            <p className="text-[11px] text-ds-faint">
              {running
                ? t('writePaperAgentTabRunning')
                : list
                  ? t('writePaperAgentTabDone')
                  : t('writePaperAgentTabStarted')}
            </p>
          </div>
          {running ? <Loader2 className="h-4 w-4 animate-spin text-ds-faint" /> : null}
        </div>
        {rows.length ? (
          <ul className="max-h-[300px] divide-y divide-ds-border-muted/60 overflow-y-auto">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 px-3.5 py-1.5 text-[12px]">
                {row.status === 'running' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                ) : row.status === 'success' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
                ) : row.status === 'error' ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-300" />
                ) : (
                  <CircleDashed className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
                )}
                <span className="shrink-0 font-medium text-ds-ink">
                  {t(`writePaperAgentTool_${row.toolName}`, { defaultValue: row.toolName })}
                </span>
                {row.query ? (
                  <span className="min-w-0 flex-1 truncate text-ds-muted" title={row.query}>
                    {row.query}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3.5 py-3 text-[12px] text-ds-faint">
            {running ? t('writePaperAgentTabWaiting') : t('writePaperAgentTabNoTools')}
          </p>
        )}
      </div>

      {list ? (
        <div className="mt-4">
          <PaperListCard list={list} workspaceRoot={workspaceRoot} />
        </div>
      ) : null}
    </div>
  )
}
