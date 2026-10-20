import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitWorkingState } from '@shared/git-commit'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { CommitBox } from './CommitBox'

type ReadyState = Extract<GitWorkingState, { ok: true }>

const api = {
  generateGitCommitMessage: vi.fn(),
  commitGitChanges: vi.fn(),
  pushGitBranch: vi.fn()
}
let renderer: ReactTestRenderer
const onChanged = vi.fn()

function state(patch: Partial<ReadyState> = {}): ReadyState {
  return {
    ok: true, repositoryRoot: '/repo', branch: 'kun/x', head: 'abc1234', upstream: null, ahead: 0, behind: 0,
    unpushed: 0, pushRemote: 'origin', staged: [{ path: 'a.ts', status: 'modified', additions: 1, deletions: 0 }],
    unstaged: [], truncated: false, ...patch
  }
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  onChanged.mockReset()
  vi.stubGlobal('window', { kunGui: { ...api, getGitWorkingState: vi.fn() } })
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } })
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  vi.unstubAllGlobals()
})

async function mount(value: ReadyState = state()): Promise<void> {
  await act(async () => {
    renderer = create(createElement(CommitBox, { workspaceRoot: '/repo', state: value, onChanged }))
  })
}
function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('')
}
function button(label: string): ReactTestInstance {
  return renderer.root.find((node) => node.type === 'button' && textOf(node).trim() === label)
}
function text(): string {
  return JSON.stringify(renderer.toJSON())
}

describe('CommitBox', () => {
  it('writes a message for a blank commit, commits, then pushes with the upstream note shown first', async () => {
    api.generateGitCommitMessage.mockResolvedValue({ ok: true, message: 'feat: add a', model: 'm' })
    api.commitGitChanges.mockResolvedValue({ ok: true, sha: 'def5678', subject: 'feat: add a' })
    api.pushGitBranch.mockResolvedValue({ ok: true, remote: 'origin', branch: 'kun/x', setUpstream: true, output: '' })
    await mount()
    expect(text()).toContain('changesFirstPushNote')
    await act(async () => button('changesCommitPush').props.onClick())
    expect(api.generateGitCommitMessage).toHaveBeenCalledWith({ workspaceRoot: '/repo', stageAll: false })
    expect(api.commitGitChanges).toHaveBeenCalledWith({ workspaceRoot: '/repo', message: 'feat: add a', stageAll: false })
    expect(api.pushGitBranch).toHaveBeenCalledWith({ workspaceRoot: '/repo' })
    expect(text()).toContain('changesPushedUpstream')
    expect(onChanged).toHaveBeenCalled()
  })

  it('does not commit when the message cannot be written', async () => {
    api.generateGitCommitMessage.mockResolvedValue({ ok: false, reason: 'model', message: 'HTTP 404' })
    await mount()
    await act(async () => button('changesCommit').props.onClick())
    expect(api.commitGitChanges).not.toHaveBeenCalled()
    expect(text()).toContain('changesGenerateFailedTitle')
    expect(text()).toContain('HTTP 404')
  })

  it('stages everything when nothing is staged and shows a copyable push error with retry', async () => {
    api.commitGitChanges.mockResolvedValue({ ok: true, sha: 'def5678', subject: 'wip' })
    api.pushGitBranch.mockResolvedValue({
      ok: false, reason: 'rejected', message: 'rejected', command: 'git push origin HEAD:refs/heads/kun/x', output: '! [rejected] kun/x'
    })
    await mount(state({ upstream: 'origin/kun/x', staged: [], unstaged: [{ path: 'b.ts', status: 'untracked', additions: 2, deletions: 0 }] }))
    await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'wip' } }))
    await act(async () => button('changesCommitAllPush').props.onClick())
    expect(api.commitGitChanges).toHaveBeenCalledWith({ workspaceRoot: '/repo', message: 'wip', stageAll: true })
    expect(text()).toContain('changesPushRejectedHint')
    expect(text()).toContain('$ git push origin HEAD:refs/heads/kun/x')
    await act(async () => button('changesCopyError').props.onClick())
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('! [rejected] kun/x'))
    api.pushGitBranch.mockResolvedValue({ ok: true, remote: 'origin', branch: 'kun/x', setUpstream: false, output: '' })
    await act(async () => button('changesRetryPush').props.onClick())
    expect(api.pushGitBranch).toHaveBeenCalledTimes(2)
    expect(text()).toContain('changesPushed')
  })

  it('offers a lone push when only commits are waiting', async () => {
    api.pushGitBranch.mockResolvedValue({ ok: true, remote: 'origin', branch: 'kun/x', setUpstream: false, output: '' })
    await mount(state({ upstream: 'origin/kun/x', ahead: 2, unpushed: 2, staged: [] }))
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0)
    await act(async () => button('changesPush').props.onClick())
    expect(api.pushGitBranch).toHaveBeenCalled()
  })
})
