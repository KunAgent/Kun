import { describe, expect, it } from 'vitest'
import { listThreads } from './threads.js'
import type { ThreadService } from '../../services/thread-service.js'

function captureListPage(): { service: ThreadService; captured: () => unknown } {
  let captured: unknown
  const service = {
    listPage: async (options: unknown) => {
      captured = options
      return { threads: [], hasMore: false }
    }
  } as unknown as ThreadService
  return { service, captured: () => captured }
}

describe('GET /v1/threads workspace scoping', () => {
  it('forwards the project root and repeated worktree roots to listPage', async () => {
    const { service, captured } = captureListPage()
    const response = await listThreads(service, new Request(
      'http://kun.local/v1/threads?workspace=/repo&workspaces=/repo-wt-a&workspaces=/repo-wt-b&workspaces=%20'
    ))
    expect(response.status).toBe(200)
    expect(captured()).toMatchObject({
      workspace: '/repo',
      workspaces: ['/repo-wt-a', '/repo-wt-b']
    })
  })

  it('rejects a malformed limit', async () => {
    const { service } = captureListPage()
    const response = await listThreads(service, new Request(
      'http://kun.local/v1/threads?limit=abc'
    ))
    expect(response.status).toBe(400)
  })

  it('omits workspaces from listPage options when no workspaces param is present', async () => {
    const { service, captured } = captureListPage()
    const response = await listThreads(service, new Request(
      'http://kun.local/v1/threads?workspace=/repo'
    ))
    expect(response.status).toBe(200)
    expect('workspaces' in (captured() as Record<string, unknown>)).toBe(false)
  })

  it('trims, drops empty values, and caps workspaces at 64 entries', async () => {
    const { service, captured } = captureListPage()
    const params = new URLSearchParams()
    for (let index = 0; index < 80; index += 1) {
      params.append('workspaces', ` /wt-${index} `)
    }
    params.append('workspaces', '')
    const response = await listThreads(service, new Request(
      `http://kun.local/v1/threads?${params.toString()}`
    ))
    expect(response.status).toBe(200)
    const workspaces = (captured() as { workspaces: string[] }).workspaces
    expect(workspaces).toHaveLength(64)
    expect(workspaces[0]).toBe('/wt-0')
    expect(workspaces[63]).toBe('/wt-63')
    expect(workspaces.every((value) => value === value.trim() && value.length > 0)).toBe(true)
  })
})
