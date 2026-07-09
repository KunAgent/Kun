import { describe, expect, it } from 'vitest'
import {
  ConnectorManifestV1Schema,
  connectorRequiresInstallPreview,
  summarizeConnectorPermissions
} from './connector-contract'

describe('connector contract', () => {
  it('validates OAuth connector manifests before installation', () => {
    expect(() => ConnectorManifestV1Schema.parse({
      schemaVersion: 1,
      id: 'google.workspace',
      name: 'Google Workspace',
      version: '1.0.0',
      auth: { kind: 'oauth2', scopes: ['drive.readonly'] }
    })).toThrow('oauth2 connectors require an authorizationUrl')
  })

  it('summarizes manifest and tool permissions for install previews', () => {
    const manifest = ConnectorManifestV1Schema.parse({
      schemaVersion: 1,
      id: 'vercel.projects',
      name: 'Vercel Projects',
      version: '1.0.0',
      auth: {
        kind: 'oauth2',
        authorizationUrl: 'https://vercel.com/oauth/authorize',
        scopes: ['projects:read'],
        tokenRotation: true,
        revocable: true
      },
      permissions: [
        {
          scopes: ['external_account'],
          capabilities: ['read', 'network'],
          risk: 'medium',
          source: 'oauth:projects:read'
        }
      ],
      tools: [
        {
          id: 'deployments.delete',
          name: 'Delete Deployment',
          adapter: 'connector',
          permissions: [
            {
              scopes: ['external_account'],
              capabilities: ['destructive', 'write'],
              risk: 'high',
              source: 'tool:deployments.delete'
            }
          ]
        }
      ]
    })

    expect(summarizeConnectorPermissions(manifest)).toEqual({
      capabilities: ['destructive', 'network', 'read', 'write'],
      scopes: ['external_account'],
      risk: 'high',
      destructive: true,
      sources: ['oauth:projects:read', 'tool:deployments.delete']
    })
    expect(connectorRequiresInstallPreview(manifest)).toBe(true)
  })

  it('does not require a scary preview for low-risk read-only connectors', () => {
    const manifest = ConnectorManifestV1Schema.parse({
      schemaVersion: 1,
      id: 'docs.readonly',
      name: 'Docs Readonly',
      version: '1.0.0',
      auth: { kind: 'none' },
      permissions: [{ capabilities: ['read'], risk: 'low' }]
    })

    expect(connectorRequiresInstallPreview(manifest)).toBe(false)
  })
})
