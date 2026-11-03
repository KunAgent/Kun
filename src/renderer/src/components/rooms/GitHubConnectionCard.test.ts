import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { GitHubConnectionCard } from './GitHubConnectionCard'

const mocks = vi.hoisted(() => ({ status: vi.fn(), authorize: vi.fn(), poll: vi.fn(), cancel: vi.fn(),
  sharing: vi.fn(), disconnect: vi.fn(), repositories: vi.fn() }))
vi.mock('./github-app-client', () => ({ githubAppClient: mocks }))
const binding = { threadId: 'thread-1' }
const disconnected = { configured: true, connected: false, reconnectRequired: false, allowModelSharing: false, repositories: [], repositoryCount: 0 }
const ready = { ...disconnected, connected: true, allowModelSharing: true, login: 'fixture-user', repositories: ['fixture/repo'], repositoryCount: 1 }
const pending = { id: 'auth-id', status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' }

describe('GitHub conversation card', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.status.mockResolvedValue(disconnected)
    mocks.authorize.mockResolvedValue(pending)
  })
  afterEach(() => { if (renderer) act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers() })
  const mount = async (props = {}) => { await act(async () => { renderer = create(createElement(GitHubConnectionCard, { binding, ...props })) }) }
  const button = (text: string) => renderer!.root.findAllByType('button').find((entry) => entry.children.includes(text))!
  const click = async (text: string) => { await act(async () => { await button(text).props.onClick() }) }
  const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(2100) }) }

  it('requires an explicit click, exposes no token field and resumes automatically after authorization', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn().mockResolvedValue(true)
    await mount({ onContinue })
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(renderer!.root.findAllByType('input')).toHaveLength(0)
    await click('Connect GitHub')
    mocks.poll.mockResolvedValue({ ...pending, status: 'connected' })
    mocks.status.mockResolvedValue(ready)
    await tick()
    expect(mocks.authorize).toHaveBeenCalledWith(binding)
    expect(onContinue).toHaveBeenCalledOnce()
    expect(JSON.stringify(renderer!.toJSON())).toContain('@fixture-user')
    await tick()
    expect(onContinue).toHaveBeenCalledOnce()
  })
  it('waits for App installation and selected repositories before continuing', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn().mockResolvedValue(true)
    await mount({ onContinue }); await click('Connect GitHub')
    mocks.poll.mockResolvedValue({ ...pending, status: 'connected' })
    mocks.status.mockResolvedValue({ ...ready, repositoryCount: 0, repositories: [] })
    await tick()
    expect(mocks.repositories).toHaveBeenCalledOnce()
    expect(onContinue).not.toHaveBeenCalled()
    mocks.status.mockResolvedValue(ready)
    await tick()
    expect(onContinue).toHaveBeenCalledOnce()
  })
  it('does not silently grant a previously connected account to another conversation', async () => {
    const onContinue = vi.fn().mockResolvedValue(true)
    mocks.status.mockResolvedValue({ ...ready, allowModelSharing: false })
    await mount({ onContinue })
    expect(onContinue).not.toHaveBeenCalled()
    expect(mocks.sharing).not.toHaveBeenCalled()
    mocks.sharing.mockResolvedValue(ready)
    await click('Use GitHub in this conversation')
    expect(mocks.sharing).toHaveBeenCalledWith(binding, true)
    expect(onContinue).toHaveBeenCalledOnce()
  })
  it('cancels polling without continuation and keeps the retry action', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn()
    await mount({ onContinue }); await click('Connect GitHub')
    mocks.cancel.mockResolvedValue({ ...pending, status: 'cancelled' })
    await click('Cancel'); await tick()
    expect(mocks.cancel).toHaveBeenCalledWith(binding, 'auth-id')
    expect(onContinue).not.toHaveBeenCalled()
    expect(button('Connect GitHub')).toBeDefined()
  })
  it('keeps retrying a safe pending continuation when the source turn has not completed yet', async () => {
    vi.useFakeTimers()
    const onContinue = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    await mount({ onContinue }); await click('Connect GitHub')
    mocks.poll.mockResolvedValue({ ...pending, status: 'connected' }); mocks.status.mockResolvedValue(ready)
    await tick(); await tick()
    expect(onContinue).toHaveBeenCalledTimes(2)
  })
  it('ignores an old polling response after the card changes conversations', async () => {
    vi.useFakeTimers()
    let complete!: (result: unknown) => void
    mocks.poll.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const onContinue = vi.fn()
    await mount({ onContinue }); await click('Connect GitHub'); await tick()
    await act(async () => { renderer!.update(createElement(GitHubConnectionCard, { binding: { threadId: 'new-thread' }, onContinue })) })
    mocks.status.mockResolvedValue(ready)
    await act(async () => { complete({ ...pending, status: 'connected' }) })
    expect(onContinue).not.toHaveBeenCalled()
    expect(mocks.repositories).not.toHaveBeenCalled()
  })
  it('does not offer authorization when publisher configuration is absent', async () => {
    mocks.status.mockResolvedValue({ ...disconnected, configured: false })
    await mount()
    expect(button('Connect GitHub')).toBeUndefined()
    expect(JSON.stringify(renderer!.toJSON())).toContain('not configured')
  })
})
