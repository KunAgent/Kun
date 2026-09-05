import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { KUN_TUI_USAGE, parseTuiOptions } from './options.js'

describe('parseTuiOptions', () => {
  it('documents shared and isolated Runtime coexistence', () => {
    expect(KUN_TUI_USAGE).toContain('kun tui --no-start')
    expect(KUN_TUI_USAGE).toContain('KUN_MANAGER_CONTROL_DIR')
    expect(KUN_TUI_USAGE).toContain('KUN_MANAGER_SETTINGS_PATH')
    expect(KUN_TUI_USAGE).toContain('KUN_DATA_DIR')
  })

  it('uses explicit flags above environment values', () => {
    const parsed = parseTuiOptions([
      '--url', 'http://127.0.0.1:19000/',
      '--runtime-token', 'flag-token',
      '--data-dir', '/tmp/kun-tui-data',
      '--workspace', '/tmp/project',
      '--thread', 'thr_1',
      '--continue',
      '--graph', '实现 TUI Graph 看板',
      '--model', 'model-a',
      '--approval-policy', 'on-request',
      '--sandbox-mode', 'workspace-write',
      '--approval-reviewer', 'agent'
    ], {
      KUN_TUI_URL: 'http://127.0.0.1:18899',
      KUN_RUNTIME_TOKEN: 'env-token'
    }, () => '/tmp/cwd')

    expect(parsed).toMatchObject({
      ok: true,
      options: {
        url: 'http://127.0.0.1:19000',
        runtimeToken: 'flag-token',
        dataDir: '/tmp/kun-tui-data',
        dataDirSource: 'argument',
        workspace: resolve('/tmp/project'),
        threadId: 'thr_1',
        continueLatest: true,
        graphPrompt: '实现 TUI Graph 看板',
        model: 'model-a',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent'
      }
    })
  })

  it('tracks whether the data dir may be replaced by the GUI-configured default', () => {
    expect(parseTuiOptions([], {}, () => '/tmp')).toMatchObject({
      ok: true,
      options: { dataDirSource: 'default' }
    })
    expect(parseTuiOptions([], { KUN_DATA_DIR: '/tmp/from-env' }, () => '/tmp')).toMatchObject({
      ok: true,
      options: { dataDir: '/tmp/from-env', dataDirSource: 'environment' }
    })
  })

  it('rejects unknown and invalid options', () => {
    expect(parseTuiOptions(['--wat'], {}, () => '/tmp')).toEqual({
      ok: false,
      message: 'unknown option: --wat'
    })
    expect(parseTuiOptions(['--approval-policy', 'unsafe'], {}, () => '/tmp')).toEqual({
      ok: false,
      message: 'invalid approval policy: unsafe'
    })
    expect(parseTuiOptions(['--approval-reviewer', 'robot'], {}, () => '/tmp')).toEqual({
      ok: false,
      message: 'invalid approval reviewer: robot'
    })
    expect(parseTuiOptions(['--graph'], {}, () => '/tmp')).toEqual({
      ok: false,
      message: 'missing Graph requirement; usage: kun --graph "<requirement>"'
    })
    expect(parseTuiOptions(['-graph'], {}, () => '/tmp')).toEqual({
      ok: false,
      message: 'missing Graph requirement; usage: kun --graph "<requirement>"'
    })
    expect(parseTuiOptions(['--graph', '--continue'], {}, () => '/tmp')).toEqual({
      ok: false,
      message: 'missing Graph requirement; usage: kun --graph "<requirement>"'
    })
    expect(parseTuiOptions(['--graph', 'implement', 'the', 'board'], {}, () => '/tmp')).toEqual({
      ok: false,
      message: 'graph requirement must be one quoted argument; usage: kun --graph "<requirement>"'
    })
  })

  it('accepts the compatibility -graph startup prompt with thread selection', () => {
    expect(parseTuiOptions([
      '--thread', 'thr_graph',
      '-graph', '分析依赖并实现',
      '--continue'
    ], {}, () => '/tmp')).toMatchObject({
      ok: true,
      options: {
        threadId: 'thr_graph',
        continueLatest: true,
        graphPrompt: '分析依赖并实现'
      }
    })
  })
})
