import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type ProxyAddress = {
  compile: (subnet: string) => (address: string) => boolean
}

// Root and the bundled runtime install separate dependency trees. Both must
// reject an IPv4 client outside the configured trusted proxy subnet.
describe.each(['package.json', 'kun/package.json'])('proxy trust in %s', (manifest) => {
  const require = createRequire(resolve(manifest))
  const proxyAddress = require('proxy-addr') as ProxyAddress

  it('does not treat every IPv4 client as a trusted mapped-IPv6 proxy', () => {
    const trust = proxyAddress.compile('::ffff:10.0.0.0/8')
    expect(trust('203.0.113.7')).toBe(false)
    expect(proxyAddress.compile('::/1')('203.0.113.7')).toBe(false)
  })

  it('keeps correctly configured IPv4 and mapped-IPv6 subnets equivalent', () => {
    for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
      const trust = proxyAddress.compile(subnet)
      expect(trust('10.20.30.40')).toBe(true)
      expect(trust('203.0.113.7')).toBe(false)
    }
  })
})
