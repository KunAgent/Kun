import { useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { Check, Copy } from 'lucide-react'
import { AssistantMarkdown } from './AssistantMarkdown'
import { FastContextEvidenceDetail } from './FastContextEvidenceDetail'
import {
  MetaChip,
  ProactiveRetryBadge,
  type DelegateDetail,
  type FastContextEvidencePack
} from './subagent-call-card-support'

/** The expanded part of a subagent card: conclusion or error, evidence and run facts. */
export function SubagentConclusionBody({
  detail,
  evidencePack,
  isFastContext,
  launcher,
  totalTokens,
  proactiveRetry,
  resultRef,
  resultUnavailableReason,
  t
}: {
  detail: DelegateDetail
  evidencePack: FastContextEvidencePack | undefined
  isFastContext: boolean
  launcher: DelegateDetail['launcher']
  totalTokens: number | undefined
  proactiveRetry: DelegateDetail['proactiveRetry']
  resultRef: DelegateDetail['resultRef']
  resultUnavailableReason: string | undefined
  t: TFunction<'common'>
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const summary = detail.summary?.trim()
  const copySummary = (): void => {
    if (!summary) return
    void navigator.clipboard?.writeText(summary).then(() => {
      setCopied(true)
      globalThis.setTimeout(() => setCopied(false), 1500)
    }).catch(() => undefined)
  }
  return (
    <div className="px-4 pb-3.5 pl-[58px]" data-testid="subagent-conclusion-body">
      {detail.error?.trim() ? (
        <pre className="max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 font-mono text-[12px] leading-5 text-ds-danger dark:border-red-800/40 dark:bg-red-500/10">
          {detail.error}
        </pre>
      ) : summary ? (
        isFastContext ? (
          <div className="max-h-[360px] overflow-y-auto text-[13.5px] leading-6 text-ds-ink">
            <AssistantMarkdown text={summary} streaming={false} className="ds-markdown text-[13.5px] leading-6 text-ds-ink" />
          </div>
        ) : (
          <p className="max-h-[320px] overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-6 text-ds-ink">{summary}</p>
        )
      ) : null}
      <FastContextEvidenceDetail pack={evidencePack} t={t} />

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {launcher === 'manager-worker' && detail.harnessId ? (
          <MetaChip title={detail.harnessId}>{detail.harnessId}</MetaChip>
        ) : null}
        {launcher === 'manager-worker' && detail.taskWorkspaceId ? (
          <MetaChip title={detail.taskWorkspaceId}>{t('subagentWorktreeBadge', { defaultValue: 'worktree' })}</MetaChip>
        ) : null}
        {detail.profile ? <MetaChip title={detail.profile}>{detail.profile}</MetaChip> : null}
        {typeof totalTokens === 'number' && totalTokens > 0 ? (
          <MetaChip>{t('subagentTokensChip', { count: totalTokens })}</MetaChip>
        ) : null}
        {detail.toolPolicy ? (
          <MetaChip>
            {detail.toolPolicy === 'readOnly' ? t('subagentPolicyReadOnly') : t('subagentPolicyFull')}
          </MetaChip>
        ) : null}
        {proactiveRetry ? <ProactiveRetryBadge retry={proactiveRetry} t={t} remaining /> : null}
        {resultRef ? (
          <MetaChip title={resultRef.artifactId}>
            {t('subagentResultSize', {
              defaultValue: '{{lines}} lines · {{bytes}} bytes',
              lines: resultRef.lineCount,
              bytes: resultRef.byteSize
            })}
          </MetaChip>
        ) : null}
        {resultUnavailableReason ? (
          <MetaChip title={resultUnavailableReason}>
            {t('subagentResultUnavailable', { defaultValue: 'Full result unavailable' })}
          </MetaChip>
        ) : null}
        <span className="flex-1" />
        {summary && !detail.error?.trim() ? (
          <button
            type="button"
            onClick={copySummary}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            data-testid="subagent-copy-conclusion"
          >
            {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2.2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
            {copied
              ? t('subagentConclusionCopied', { defaultValue: 'Copied' })
              : t('subagentConclusionCopy', { defaultValue: 'Copy conclusion' })}
          </button>
        ) : null}
      </div>
    </div>
  )
}
