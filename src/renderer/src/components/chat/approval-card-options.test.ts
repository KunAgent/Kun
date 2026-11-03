import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { approvalOptionRows, approvalOptionScope } from './approval-card-options'

describe('approval option scopes', () => {
  it('reads the prefix or path an always-allow option is scoped to', () => {
    expect(approvalOptionScope('Always allow `npx vitest:*`')).toBe('npx vitest …')
    expect(approvalOptionScope('Always allow Bash(npm test:*)')).toBe('npm test …')
    expect(approvalOptionScope('Allow edits in "src/main/" for this session')).toBe('src/main/')
    expect(approvalOptionScope('Always Allow')).toBeNull()
    expect(approvalOptionScope('`*`')).toBeNull()
    expect(approvalOptionScope(undefined)).toBeNull()
  })

  it('shortens long scopes for the inline chip', () => {
    const scope = approvalOptionScope(`\`${'pnpm --filter @kun/renderer exec vitest run '.repeat(2)}\``)!
    expect(scope.length).toBeLessThanOrEqual(36)
    expect(scope.endsWith(' …')).toBe(true)
  })
})

describe('approval option rows (rendered copy)', () => {
  beforeAll(async () => {
    await i18n.loadLanguages('zh')
  })
  const zh = (key: string, options?: Record<string, unknown>) => i18n.t(key, { lng: 'zh', ...options })
  const en = (key: string, options?: Record<string, unknown>) => i18n.t(key, { lng: 'en', ...options })

  it('describes allow once, a scoped always and deny like the design', () => {
    const { rows, deny } = approvalOptionRows('command', [
      { optionId: 'once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'always', name: 'Always Allow `npx vitest:*`', kind: 'allow_always' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' }
    ], zh)
    expect(rows.map((row) => row.label)).toEqual(['允许', '始终允许'])
    expect(rows[0].description).toEqual({ text: '仅这一次' })
    expect(rows[1].description).toEqual({ before: '本次会话里 ', code: 'npx vitest …', after: ' 不再询问' })
    expect(deny).toMatchObject({ label: '拒绝', description: { text: '这次先拒绝' }, choice: { optionId: 'no' } })
  })

  it('phrases edit scopes as paths and keeps specific runtime wording', () => {
    const { rows } = approvalOptionRows('edit', [
      { optionId: 'always', name: 'Always allow `src/main/`', kind: 'allow_always' },
      { optionId: 'yes-session', name: "Yes, and don't ask again for this command", kind: 'allow_always' }
    ], en)
    expect(rows[0].description).toEqual({ before: "Don't ask again for edits in ", code: 'src/main/', after: ' this session' })
    expect(rows[1].description).toEqual({ text: "Yes, and don't ask again for this command" })
  })

  it('puts allow once first whatever order the runtime lists, keeping deny last', () => {
    const { rows, deny } = approvalOptionRows('command', [
      { optionId: 'always', name: 'Always Allow', kind: 'allow_always' },
      { optionId: 'never', name: 'Always Reject', kind: 'reject_always' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      { optionId: 'once', name: 'Allow', kind: 'allow_once' }
    ], en)
    expect(rows.map((row) => row.choice)).toEqual([{ optionId: 'once' }, { optionId: 'always' }, { optionId: 'never' }])
    expect(rows.map((row) => row.decision)).toEqual(['allow', 'allow', 'deny'])
    expect(deny.choice).toEqual({ optionId: 'no' })
  })

  it('falls back to the session copy for an unscoped always option', () => {
    const { rows } = approvalOptionRows('command', [{ optionId: 'a', name: 'Always Allow', kind: 'allow_always' }], zh)
    expect(rows[0].description).toEqual({ text: '本次会话里不再询问' })
  })
})
