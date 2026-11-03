import { afterEach, describe, expect, it, vi } from 'vitest'
import { AtomicJsonFile, configureManagerAtomicJsonClient } from './atomic-json.js'
import { ServiceManagerTransportError } from '../manager/usage-errors.js'

function validateCounter(value: unknown): { count: number } {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { count?: unknown }).count !== 'number'
  ) throw new Error('invalid counter')
  return value as { count: number }
}

afterEach(() => {
  configureManagerAtomicJsonClient(null)
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('AtomicJsonFile manager data plane', () => {
  it('uses an in-memory Main client override without mutating process.env', async () => {
    vi.stubEnv('KUN_MANAGER_BASE_URL', '')
    vi.stubEnv('KUN_MANAGER_TOKEN', '')
    vi.stubEnv('KUN_MANAGER_DATA_DIR', '')
    configureManagerAtomicJsonClient({
      baseUrl: 'http://127.0.0.1:19001',
      token: 'memory-only-manager-secret',
      dataDir: '/tmp/kun-main-data'
    })
    const fetchMock = vi.fn(async () => Response.json({
      snapshot: { revision: 1, value: { count: 7 } }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const file = new AtomicJsonFile('/tmp/kun-main-data/state.json', validateCounter)
    await expect(file.read(() => ({ count: 0 }))).resolves.toEqual({ count: 7 })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:19001/v1/data/atomic-json/read',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer memory-only-manager-secret' })
      })
    )
    expect(process.env.KUN_MANAGER_TOKEN).toBe('')
  })

  it('uses manager CAS and retries against the latest shared revision', async () => {
    vi.stubEnv('KUN_MANAGER_BASE_URL', 'http://127.0.0.1:19000')
    vi.stubEnv('KUN_MANAGER_TOKEN', 'manager-secret')
    vi.stubEnv('KUN_MANAGER_DATA_DIR', '/tmp/kun-shared-data')
    const responses = [
      new Response(JSON.stringify({ snapshot: { revision: 1, value: { count: 2 } } })),
      new Response(JSON.stringify({ code: 'revision_conflict', currentRevision: 2 }), { status: 409 }),
      new Response(JSON.stringify({ snapshot: { revision: 2, value: { count: 3 } } })),
      new Response(JSON.stringify({ snapshot: { revision: 3, value: { count: 4 } } }))
    ]
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) => responses.shift() ?? new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const file = new AtomicJsonFile('/tmp/kun-shared-data/extensions/state.json', validateCounter)
    await expect(file.update(() => ({ count: 0 }), (current) => ({
      count: current.count + 1
    }))).resolves.toEqual({ count: 4 })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:19000/v1/data/atomic-json/read')
    const finalWrite = fetchMock.mock.calls[3]?.[1] as RequestInit
    expect(finalWrite.headers).toMatchObject({ authorization: 'Bearer manager-secret' })
    expect(JSON.parse(String(finalWrite.body))).toMatchObject({
      expectedRevision: 2,
      value: { count: 4 }
    })
  })

  it('does not route profile-local JSON outside the canonical data directory', async () => {
    vi.stubEnv('KUN_MANAGER_BASE_URL', 'http://127.0.0.1:19000')
    vi.stubEnv('KUN_MANAGER_TOKEN', 'manager-secret')
    vi.stubEnv('KUN_MANAGER_DATA_DIR', '/tmp/kun-shared-data')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const file = new AtomicJsonFile('/tmp/kun-dv-profile/view-state.json', validateCounter)
    await expect(file.read(() => ({ count: 9 }))).resolves.toEqual({ count: 9 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries an expired Manager read once so a slow Manager cannot fail the caller', async () => {
    vi.stubEnv('KUN_MANAGER_BASE_URL', 'http://127.0.0.1:19000')
    vi.stubEnv('KUN_MANAGER_TOKEN', 'manager-secret')
    vi.stubEnv('KUN_MANAGER_DATA_DIR', '/tmp/kun-shared-data')
    const timeout = new ServiceManagerTransportError(
      'timeout',
      'Kun Service Manager connection failed (timeout; 5000ms).'
    )
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(Response.json({ snapshot: { revision: 1, value: { count: 5 } } }))
    vi.stubGlobal('fetch', fetchMock)

    const file = new AtomicJsonFile('/tmp/kun-shared-data/registry.json', validateCounter)
    await expect(file.read(() => ({ count: 0 }))).resolves.toEqual({ count: 5 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not replay a Manager read that failed for a non-timeout reason', async () => {
    vi.stubEnv('KUN_MANAGER_BASE_URL', 'http://127.0.0.1:19000')
    vi.stubEnv('KUN_MANAGER_TOKEN', 'manager-secret')
    vi.stubEnv('KUN_MANAGER_DATA_DIR', '/tmp/kun-shared-data')
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new ServiceManagerTransportError('socket_closed', 'socket closed'))
      .mockResolvedValueOnce(Response.json({ snapshot: { revision: 1, value: { count: 5 } } }))
    vi.stubGlobal('fetch', fetchMock)

    const file = new AtomicJsonFile('/tmp/kun-shared-data/registry.json', validateCounter)
    await expect(file.read(() => ({ count: 0 }))).rejects.toMatchObject({ kind: 'socket_closed' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
