import { describe, expect, it, vi } from 'vitest'
import type { ExecFileException } from 'node:child_process'
import type os from 'node:os'
import {
  detectTailscaleAccess,
  findTailscaleIpv4FromInterfaces,
  isTailscaleCgnatIpv4,
  parseTailscaleIpv4FromCliOutput,
  tailscaleBinaryCandidates
} from './remote-tailscale'

const emptyIfaces = {
  lo0: [
    {
      address: '127.0.0.1',
      family: 'IPv4',
      internal: true,
      netmask: '255.0.0.0',
      cidr: null,
      mac: ''
    }
  ],
  en0: [
    {
      address: '192.168.91.55',
      family: 'IPv4',
      internal: false,
      netmask: '255.255.255.0',
      cidr: null,
      mac: ''
    }
  ]
} as NodeJS.Dict<os.NetworkInterfaceInfo[]>

function ipv4(address: string): os.NetworkInterfaceInfo {
  return {
    address,
    family: 'IPv4',
    internal: false,
    netmask: '255.255.255.255',
    cidr: null,
    mac: ''
  }
}

function enoent(): ExecFileException {
  const error = new Error('not found') as ExecFileException
  error.code = 'ENOENT'
  return error
}

function execError(code: string | number, stdout = ''): { error: ExecFileException; stdout: string } {
  const error = new Error('tailscale failed') as ExecFileException
  error.code = code
  return { error, stdout }
}

describe('isTailscaleCgnatIpv4', () => {
  it('accepts the 100.64.0.0/10 bounds and rejects neighbors', () => {
    expect(isTailscaleCgnatIpv4('100.64.0.0')).toBe(true)
    expect(isTailscaleCgnatIpv4('100.111.83.99')).toBe(true)
    expect(isTailscaleCgnatIpv4('100.127.255.255')).toBe(true)
    expect(isTailscaleCgnatIpv4('100.63.255.255')).toBe(false)
    expect(isTailscaleCgnatIpv4('100.128.0.0')).toBe(false)
    expect(isTailscaleCgnatIpv4('192.168.1.1')).toBe(false)
    expect(isTailscaleCgnatIpv4('not-an-ip')).toBe(false)
  })
})

describe('parseTailscaleIpv4FromCliOutput', () => {
  it('reads a bare address, surrounding text, and buffers', () => {
    expect(parseTailscaleIpv4FromCliOutput('100.111.83.99\n')).toBe('100.111.83.99')
    expect(parseTailscaleIpv4FromCliOutput('IPv4: 100.111.83.99/32\n')).toBe('100.111.83.99')
    expect(parseTailscaleIpv4FromCliOutput(Buffer.from('100.111.83.99\n'))).toBe('100.111.83.99')
    expect(parseTailscaleIpv4FromCliOutput('100.200.1.1\n192.168.1.1')).toBeNull()
    expect(parseTailscaleIpv4FromCliOutput(null)).toBeNull()
  })
})

describe('findTailscaleIpv4FromInterfaces', () => {
  it('prefers a Tailscale/utun CGNAT address over other 100.64/10 hits', () => {
    const interfaces = {
      en0: [ipv4('100.64.1.2')],
      utun6: [ipv4('100.111.83.99')],
      docker0: [ipv4('172.18.0.1')]
    } as NodeJS.Dict<os.NetworkInterfaceInfo[]>
    expect(findTailscaleIpv4FromInterfaces(interfaces)).toBe('100.111.83.99')
  })

  it('returns null when no CGNAT address is present', () => {
    expect(findTailscaleIpv4FromInterfaces(emptyIfaces)).toBeNull()
  })
})

describe('tailscaleBinaryCandidates', () => {
  it('includes GUI-app PATH fallbacks on macOS', () => {
    expect(tailscaleBinaryCandidates('darwin', {})).toEqual([
      'tailscale',
      '/usr/local/bin/tailscale',
      '/opt/homebrew/bin/tailscale',
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
    ])
  })
})

describe('detectTailscaleAccess', () => {
  it('treats a utun CGNAT address as connected without running the CLI', async () => {
    const execFile = vi.fn()
    const result = await detectTailscaleAccess({
      interfaces: {
        ...emptyIfaces,
        utun6: [ipv4('100.111.83.99')]
      },
      execFile: execFile as never,
      existsSync: () => false,
      platform: 'darwin',
      env: {}
    })
    expect(result).toEqual({ installed: true, connected: true, ipv4: '100.111.83.99' })
    expect(execFile).not.toHaveBeenCalled()
  })

  it('parses CLI stdout even when the process exits non-zero', async () => {
    const execFile = vi.fn((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      const { error, stdout } = execError(1, 'failed\n100.111.83.99\n')
      callback(error, stdout)
    })
    const result = await detectTailscaleAccess({
      interfaces: emptyIfaces,
      execFile: execFile as never,
      existsSync: (path) => path === '/usr/local/bin/tailscale',
      platform: 'darwin',
      env: { PATH: '/usr/bin' }
    })
    expect(result).toEqual({ installed: true, connected: true, ipv4: '100.111.83.99' })
  })

  it('reports installed-but-disconnected when the app exists without a tailnet IP', async () => {
    const execFile = vi.fn((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      callback(enoent(), '')
    })
    const result = await detectTailscaleAccess({
      interfaces: emptyIfaces,
      execFile: execFile as never,
      existsSync: (path) => path === '/Applications/Tailscale.app',
      platform: 'darwin',
      env: { PATH: '/usr/bin' }
    })
    expect(result).toEqual({ installed: true, connected: false, ipv4: null })
  })

  it('reports missing when no app, binary, or CGNAT address is present', async () => {
    const execFile = vi.fn((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      callback(enoent(), '')
    })
    const result = await detectTailscaleAccess({
      interfaces: emptyIfaces,
      execFile: execFile as never,
      existsSync: () => false,
      platform: 'darwin',
      env: { PATH: '/usr/bin' }
    })
    expect(result).toEqual({ installed: false, connected: false, ipv4: null })
  })
})
