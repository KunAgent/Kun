import { beforeEach, describe, expect, it, vi } from 'vitest'
import { electronProxyRuleUrl, resolveElectronSystemProxyUrl } from './electron-system-proxy'

const resolveProxy = vi.hoisted(() => vi.fn(async (_url: string) => 'DIRECT'))
vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy } } }))
beforeEach(() => { resolveProxy.mockReset().mockResolvedValue('DIRECT') })

describe('Electron proxy rule authority parsing', () => {
  it.each([
    ['PROXY', 'proxy.invalid:80', 'http://proxy.invalid/'],
    ['HTTPS', 'proxy.invalid:443', 'https://proxy.invalid/'],
    ['PROXY', '[::1]:80', 'http://[::1]/'],
    ['HTTPS', '[2001:db8::1]:443', 'https://[2001:db8::1]/'],
    ['PROXY', '127.0.0.1:8080', 'http://127.0.0.1:8080/'],
    ['SOCKS', '[::1]:1080', 'socks5://[::1]:1080'],
    ['SOCKS4', 'proxy.invalid:1080', 'socks4://proxy.invalid:1080']
  ])('supports explicit %s proxy %s', (kind, target, expected) => {
    expect(electronProxyRuleUrl(kind, target)).toBe(expected)
  })

  it.each([
    '', 'proxy.invalid', 'proxy.invalid:', 'proxy.invalid:0', 'proxy.invalid:65536',
    'proxy.invalid:-80', 'proxy.invalid:port', 'proxy.invalid:80/path',
    'proxy.invalid:80?query', 'proxy.invalid:80#hash', 'user:secret@proxy.invalid:80',
    'proxy.invalid:80 ', 'proxy.invalid\\path:80', '::1:80', '[invalid]:80', '[::1]',
    '[::1]:443/path'
  ])('rejects malformed or non-explicit authority %s', (target) => {
    expect(electronProxyRuleUrl('PROXY', target)).toBe('')
  })

  it('does not reinterpret unsupported rule types', () => {
    expect(electronProxyRuleUrl('DIRECT', 'proxy.invalid:80')).toBe('')
    expect(electronProxyRuleUrl('INVALID', 'proxy.invalid:80')).toBe('')
  })
})

describe('provider probe system proxy resolution', () => {
  it('retains first supported proxy selection, including default ports', async () => {
    resolveProxy.mockResolvedValue('PROXY proxy.invalid:80; HTTPS other.invalid:443; DIRECT')
    expect(await resolveElectronSystemProxyUrl('https://api.example.test/')).toBe('http://proxy.invalid/')
    expect(resolveProxy).toHaveBeenCalledWith('https://api.example.test/')
    resolveProxy.mockResolvedValue('HTTPS [::1]:443; DIRECT')
    expect(await resolveElectronSystemProxyUrl('https://api.example.test/')).toBe('https://[::1]/')
  })

  it('retains direct fallback and skips unsupported rules without exposing resolver errors', async () => {
    expect(await resolveElectronSystemProxyUrl('https://api.example.test/')).toBe('')
    resolveProxy.mockResolvedValue('INVALID unused; PROXY proxy.invalid:8080')
    expect(await resolveElectronSystemProxyUrl('https://api.example.test/')).toBe('http://proxy.invalid:8080/')
    resolveProxy.mockRejectedValue(new Error('private resolver error'))
    expect(await resolveElectronSystemProxyUrl('https://api.example.test/')).toBe('')
  })
})
