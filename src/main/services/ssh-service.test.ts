import { describe, expect, it, vi } from 'vitest'
import { buildSshTestArgs, testSshConnection, type SshProcessRunner } from './ssh-service'

describe('ssh-service', () => {
  it('builds a non-interactive system ssh command', () => {
    const args = buildSshTestArgs({
      host: 'vps.example.com',
      user: 'deploy',
      port: 2222,
      remotePath: "/srv/app's"
    })

    expect(args).toEqual([
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      '-p',
      '2222',
      'deploy@vps.example.com',
      "cd '/srv/app'\\''s' && pwd"
    ])
  })

  it('rejects empty or unsafe ssh targets', () => {
    expect(() => buildSshTestArgs({ host: '', port: 22 })).toThrow(/host is required/i)
    expect(() => buildSshTestArgs({ host: '-bad', port: 22 })).toThrow(/unsupported/i)
    expect(() =>
      buildSshTestArgs({ host: 'vps.example.com', user: 'bad@user', port: 22 })
    ).toThrow(/unsupported/i)
  })

  it('returns a success message from stdout', async () => {
    const runner = vi.fn(async () => ({
      ok: true as const,
      code: 0,
      signal: null,
      stdout: '/srv/app\n',
      stderr: '',
      timedOut: false
    })) satisfies SshProcessRunner

    const result = await testSshConnection({
      host: 'vps.example.com',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/app'
    }, runner)

    expect(runner).toHaveBeenCalledWith('ssh', expect.any(Array), 12_000)
    expect(result).toEqual({ ok: true, message: 'SSH connection succeeded: /srv/app' })
  })

  it('returns stderr on connection failure', async () => {
    const runner = vi.fn(async () => ({
      ok: true as const,
      code: 255,
      signal: null,
      stdout: '',
      stderr: 'Permission denied (publickey).',
      timedOut: false
    })) satisfies SshProcessRunner

    await expect(testSshConnection({ host: 'vps.example.com', port: 22 }, runner)).resolves.toEqual({
      ok: false,
      message: 'Permission denied (publickey).'
    })
  })
})
