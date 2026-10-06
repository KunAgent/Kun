import { describe, expect, it } from 'vitest'
import { exportProviderConfiguration, prepareProviderImport } from './provider-configuration-exchange.js'
import { ProviderConfigurationStateSchema, type ProviderConfigurationSnapshot } from '../contracts/provider-configuration.js'
import { ModelRoutePoolConfigSchema } from '../contracts/model-route-pool.js'

function snapshot(): ProviderConfigurationSnapshot {
  return { schemaVersion: 2, revision: 7, activeRevision: 7, configuration: ProviderConfigurationStateSchema.parse({
    groups: { team: { id: 'team', name: 'Team' } }, connections: { one: { groupId: 'team' } }
  }), connections: [{ id: 'one', accountId: 'account-one', name: 'One', authType: 'api-key', kind: 'http',
    baseUrl: 'https://one.test', endpointFormat: 'chat_completions', useProxy: false, configured: true,
    models: ['model'], customHeaderNames: ['X-Private'] }], routePools: [ModelRoutePoolConfigSchema.parse({
    id: 'coding', name: 'Coding', modelId: 'route/coding',
    failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
    healthPolicy: { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 1 }, targets: [{ id: 'one', providerId: 'one', modelId: 'model' }]
  })], failover: [], localModelGateway: { enabled: false, exposeProviderModels: false }, fieldSources: {} }
}
describe('provider exchange closure', () => {
  it('remaps conflicting group/account/route IDs and public aliases while keeping secrets as unbound slots', () => {
    const current = snapshot(), exported = exportProviderConfiguration(current)
    const preview = prepareProviderImport({ ...exported, expectedRevision: 7 }, current)
    expect(preview.remaps.connection.one).toBe('one-import-1')
    expect(preview.secretSlots).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId: 'one-import-1', bound: false })]))
    expect(preview.operations.find((operation) => operation.kind === 'configure-connection')).toMatchObject({
      connectionId: 'one-import-1', configuration: { groupId: 'team-import-1' } })
    const routes = preview.operations.find((operation) => operation.kind === 'set-routes')
    if (routes?.kind !== 'set-routes') throw new Error('Missing routes')
    expect(routes.routes).toHaveLength(2)
    expect(routes.routes[1]).toMatchObject({ modelId: 'route/coding-import-1', targets: [{ providerId: 'one-import-1' }] })
    expect(JSON.stringify(exported)).not.toContain('credentialRef')
    expect(JSON.stringify(exported)).not.toContain('account-one')
  })
  it('rejects dangling references, local secret references and permission changes in exchange files', () => {
    const current = snapshot(), exported = exportProviderConfiguration(current)
    expect(() => prepareProviderImport({ ...exported, expectedRevision: 7,
      operations: exported.operations.filter((operation) => operation.kind !== 'add-connection') }, current)).toThrow('unresolved')
    expect(() => prepareProviderImport({ ...exported, expectedRevision: 7, credentialRef: 'local-secret' }, current)).toThrow()
    expect(() => prepareProviderImport({ ...exported, expectedRevision: 7, operations: [
      { kind: 'set-client-policy', clientId: 'client', policy: {} }] }, current)).toThrow('separate reviewed')
  })
})
