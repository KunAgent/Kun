import { describe, expect, it } from 'vitest'
import { listSshHostAliases, parseSshConfig, resolveSshHost } from './ssh-config.js'

const CONFIG = `
# personal hosts
Host production-api
  HostName 10.0.0.5
  User deploy
  Port 2222
  IdentityFile ~/.ssh/prod
  ProxyJump bastion

Host staging-*
  User stage

Host bastion
  HostName bastion.example.com

Host *
  ServerAliveInterval 30
`

describe('ssh-config', () => {
  it('lists only concrete aliases (skips wildcards)', () => {
    expect(listSshHostAliases(CONFIG)).toEqual(['production-api', 'bastion'])
  })

  it('resolves a concrete host with all settings', () => {
    expect(resolveSshHost(CONFIG, 'production-api')).toEqual({
      alias: 'production-api',
      hostName: '10.0.0.5',
      user: 'deploy',
      port: 2222,
      identityFile: '~/.ssh/prod',
      proxyJump: 'bastion'
    })
  })

  it('returns null for an unknown alias', () => {
    expect(resolveSshHost(CONFIG, 'nope')).toBeNull()
  })

  it('parses every concrete host', () => {
    expect(parseSshConfig(CONFIG).map((h) => h.alias)).toEqual(['production-api', 'bastion'])
  })

  it('supports Key=value syntax and is case-insensitive', () => {
    const host = resolveSshHost('Host h\n  HostName=example.com\n  USER=root', 'h')
    expect(host).toMatchObject({ hostName: 'example.com', user: 'root' })
  })
})
