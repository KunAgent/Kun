export type HandoffContinuationFailure = {
  stage: string
  code: string
  message: string
  detailsAvailable: boolean
  rpcCode?: number
}

export function handoffRestartLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  block: { toHarnessName: string; recentTurns: number; continuationFailure?: HandoffContinuationFailure }
): string {
  const status = t('adeHandoffRestart', { agent: block.toHarnessName, turns: block.recentTurns })
  const failure = block.continuationFailure
  if (!failure) return status
  const reasonKeys: Record<string, string> = {
    history_changed: 'adeHandoffHistoryChanged',
    capabilities_changed: 'adeHandoffCapabilitiesChanged',
    load_session_unsupported: 'adeHandoffLoadUnsupported'
  }
  const reasonKey = reasonKeys[failure.code]
  const reason = reasonKey
    ? t(reasonKey, { agent: block.toHarnessName })
    : failure.detailsAvailable
      ? `${failure.stage}: ${failure.message.slice(0, 240)} (${failure.code}${failure.rpcCode === undefined ? '' : ` / ${failure.rpcCode}`})`
      : t('adeHandoffNoErrorDetails', { agent: block.toHarnessName })
  return `${status} — ${reason}`
}
