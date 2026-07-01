import { describe, expect, it } from 'vitest'
import { dispatchRequest } from '../http-server.js'
import { computeContentHash } from '../../supplychain/package-audit.js'
import { InMemoryPublisherTrustStore } from '../../supplychain/publisher-trust-store.js'
import { buildHarness, readJson } from '../../../tests/http-server-test-harness.js'

describe('supply-chain routes', () => {
  it('audits package bytes through an authenticated runtime route', async () => {
    const h = buildHarness()
    h.runtime.supplyChainTrust = new InMemoryPublisherTrustStore()
    const content = Buffer.from('downloaded package bytes')
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/supply-chain/audit', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'mcp',
          manifest: {
            name: '@example/tool',
            version: '1.2.3',
            publisher: 'example',
            contentHash: computeContentHash(content),
            permissions: ['network']
          },
          contentBase64: content.toString('base64'),
          strict: false,
          sensitivePermissionConsent: true
        })
      })
    )

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      installable: true,
      hashVerified: true,
      findings: expect.arrayContaining([expect.objectContaining({ code: 'hash_verified' })])
    })
  })

  it('requires auth and rejects malformed audit bodies', async () => {
    const h = buildHarness()
    const unauthorized = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/supply-chain/audit', { method: 'POST' })
    )
    expect(unauthorized.status).toBe(401)

    const invalid = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/supply-chain/audit', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          manifest: { name: '@example/tool', version: '1.2.3' },
          contentBase64: 'not base64'
        })
      })
    )
    expect(invalid.status).toBe(400)
  })

  it('checks update policy through the runtime route', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/supply-chain/update-check', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          current: { name: '@example/tool', version: '1.2.3', permissions: [] },
          next: { name: '@example/tool', version: '1.2.4', permissions: ['secret'] },
          autoUpdate: true
        })
      })
    )

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      allowed: false,
      requiresConsent: true,
      reason: expect.stringContaining('secret')
    })
  })
})
