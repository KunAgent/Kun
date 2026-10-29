import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'
import zh from '../locales/zh/common/ade.json'
import en from '../locales/en/common/ade.json'
import { handoffRestartLabel, type HandoffContinuationFailure } from './handoff-continuation'

const block = { toHarnessName: 'Devin', recentTurns: 4 }
const failure: HandoffContinuationFailure = {
  stage: 'session/load', code: 'agent_error', rpcCode: -32002,
  message: 'session not found', detailsAvailable: true
}

async function translate(language = 'zh') {
  const i18n = createInstance()
  await i18n.init({ lng: language, fallbackLng: false, resources: { zh: { common: zh }, en: { common: en } },
    defaultNS: 'common', interpolation: { escapeValue: false } })
  return i18n.getFixedT(language, 'common')
}

describe('native continuation recovery labels', () => {
  it('preserves recovery state and adds the available stage/code/message', async () => {
    const label = handoffRestartLabel(await translate(), { ...block, continuationFailure: failure })
    expect(label).toContain('最近 4 轮')
    expect(label).toContain('session/load: session not found (agent_error / -32002)')
  })
  it('explicitly identifies missing Devin-side details', async () => {
    const label = handoffRestartLabel(await translate(), { ...block,
      continuationFailure: { ...failure, message: '', detailsAvailable: false } })
    expect(label).toContain('未收到 Devin 侧错误详情')
    expect(label).not.toContain('session not found')
  })
  it('does not blame Devin for local history changes', async () => {
    const label = handoffRestartLabel(await translate(), { ...block,
      continuationFailure: { ...failure, code: 'history_changed', detailsAvailable: false } })
    expect(label).toContain('未向 Devin 请求续接')
    expect(label).not.toContain('session/load:')
  })
  it('explains unsupported restoration without inventing an upstream error', async () => {
    const label = handoffRestartLabel(await translate(), { ...block,
      continuationFailure: { ...failure, code: 'load_session_unsupported', detailsAvailable: false } })
    expect(label).toContain('不支持恢复')
    expect(label).toContain('未收到 Devin 侧错误详情')
  })
  it('keeps legacy notices unchanged and supports English', async () => {
    const t = await translate('en')
    expect(handoffRestartLabel(t, block)).toBe(t('adeHandoffRestart', { agent: 'Devin', turns: 4 }))
    expect(handoffRestartLabel(t, { ...block, continuationFailure: { ...failure, detailsAvailable: false } }))
      .toContain('No error details received from Devin')
  })
})
