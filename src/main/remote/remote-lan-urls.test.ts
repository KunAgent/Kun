import { describe, expect, it } from 'vitest'
import { lanUrlsForPort } from './remote-lan-urls'

const interfaces = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', cidr: null, mac: '' }],
  en0: [
    { address: '192.168.1.10', family: 'IPv4', internal: false, netmask: '255.255.255.0', cidr: null, mac: '' },
    { address: 'fe80::1', family: 'IPv6', internal: false, netmask: '', cidr: null, mac: '' }
  ],
  utun3: [{ address: '10.9.0.2', family: 'IPv4', internal: false, netmask: '255.255.0.0', cidr: null, mac: '' }],
  vboxnet0: [{ address: '192.168.56.1', family: 'IPv4', internal: false, netmask: '255.255.255.0', cidr: null, mac: '' }],
  en1: [{ address: '10.0.0.5', family: 'IPv4', internal: false, netmask: '255.0.0.0', cidr: null, mac: '' }]
} as never

describe('lanUrlsForPort', () => {
  it('returns LAN urls with physical interfaces first', () => {
    const urls = lanUrlsForPort(3737, interfaces)
    expect(urls).toContain('http://192.168.1.10:3737')
    expect(urls).toContain('http://10.0.0.5:3737')
    expect(urls).toContain('http://10.9.0.2:3737')
    expect(urls).not.toContain('http://127.0.0.1:3737')
    expect(urls.every((url) => !url.includes('::'))).toBe(true)
    // en0's 192.168.x.x beats the VPN-ish utun adapter.
    expect(urls.indexOf('http://192.168.1.10:3737')).toBeLessThan(
      urls.indexOf('http://10.9.0.2:3737')
    )
  })

  it('skips invalid and broadcast addresses', () => {
    const urls = lanUrlsForPort(1, {
      en9: [
        { address: '0.0.0.0', family: 'IPv4', internal: false },
        { address: '224.0.0.1', family: 'IPv4', internal: false },
        { address: 'not-an-ip', family: 'IPv4', internal: false },
        { address: '172.16.5.5', family: 'IPv4', internal: false }
      ]
    } as never)
    expect(urls).toEqual(['http://172.16.5.5:1'])
  })
})
