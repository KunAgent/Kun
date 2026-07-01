import { describe, expect, it, vi } from 'vitest'
import { createRemoteHostsService } from './remote-hosts-service.js'
import type { SshChildProcess } from './ssh-executor.js'

const SSH_CONFIG = `
Host prod-api
  HostName 10.0.0.5
  User deploy
  Port 2222

Host staging-*
  User ci
`

function scriptedChild(stdout: string, exitCode = 0): SshChildProcess {
  return {
    stdout: { on: (_e: string, l: (c: Buffer) => void) => setTimeout(() => l(Buffer.from(stdout)), 0) },
    stderr: { on: () => undefined },
    on(event: string, listener: (...a: unknown[]) => void) {
      if (event === 'close') setTimeout(() => listener(exitCode, null), 1)
    },
    kill: vi.fn()
  } as unknown as SshChildProcess
}

describe('remote-hosts-service', () => {
  it('lists concrete ssh aliases (no wildcards)', async () => {
    const service = createRemoteHostsService({ readSshConfig: async () => SSH_CONFIG })
    const result = await service.listHosts()
    expect(result.configFound).toBe(true)
    expect(result.hosts.map((h) => h.alias)).toEqual(['prod-api'])
    expect(result.hosts[0]).toMatchObject({ hostName: '10.0.0.5', user: 'deploy', port: 2222 })
  })

  it('reports configFound:false when there is no config', async () => {
    const service = createRemoteHostsService({ readSshConfig: async () => null })
    const result = await service.listHosts()
    expect(result).toEqual({ hosts: [], configFound: false })
  })

  it('tests a connection by probing then running the precheck', async () => {
    const responses = ['', '/srv/api', 'Linux prod', '## main...origin/main', '/srv/api', 'rg=yes\ngit=yes']
    let i = 0
    const spawn = vi.fn(() => scriptedChild(responses[i++] ?? ''))
    const service = createRemoteHostsService({ readSshConfig: async () => SSH_CONFIG, spawn })
    const result = await service.testConnection({ alias: 'prod-api', remoteDir: '/srv/api' })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('connected')
    expect(result.os).toBe('Linux prod')
    expect(result.branch).toBe('main')
  })

  it('returns an error status when the probe fails', async () => {
    const spawn = vi.fn(() => scriptedChild('', 255))
    const service = createRemoteHostsService({ readSshConfig: async () => SSH_CONFIG, spawn })
    const result = await service.testConnection({ alias: 'prod-api' })
    expect(result.ok).toBe(false)
    expect(result.status).toBe('error')
  })

  it('lists valid profiles and skips secret-bearing ones', async () => {
    const service = createRemoteHostsService({
      profiles: [
        { name: 'Prod', host: 'prod-api', workspace: '/srv/api', mode: 'operations', production: true, protectedPaths: ['.env'] },
        { name: 'Bad', host: 'h', workspace: '/a', password: 'hunter2' }
      ]
    })
    const profiles = await service.listProfiles()
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ name: 'Prod', mode: 'operations', production: true })
  })
})
