import { describe, expect, it, vi } from 'vitest'
import { createGitHubFetch, GITHUB_WIRE_FENCE, type GitHubFetchInit } from './network.js'

describe('GitHub transport boundary', () => {
  it('rejects unexpected origins and credentials in destinations before proxy resolution', async () => {
    const proxy = vi.fn(async () => '')
    const request = createGitHubFetch(proxy)
    for (const url of ['https://attacker.test/token', 'http://api.github.com/user',
      'https://user:secret@github.com/login/oauth/access_token']) {
      await expect(request(url)).rejects.toThrow('Unexpected GitHub destination')
    }
    expect(proxy).not.toHaveBeenCalled()
  })
  it('rechecks conversation authority after asynchronous proxy lookup and before sending credentials', async () => {
    let release!: (value: string) => void
    const lookup = new Promise<string>((resolve) => { release = resolve })
    const request = createGitHubFetch(async () => lookup)
    let allowed = true
    const fence = vi.fn(() => { if (!allowed) throw new Error('Conversation was revoked') })
    const response = request('https://api.github.com/user', { headers: { authorization: 'Bearer synthetic-only' },
      [GITHUB_WIRE_FENCE]: fence } as GitHubFetchInit)
    allowed = false; release('http://127.0.0.1:9')
    await expect(response).rejects.toThrow('Conversation was revoked')
    expect(fence).toHaveBeenCalledTimes(2)
  })
})
