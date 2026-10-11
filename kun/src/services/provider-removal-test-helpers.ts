import type { ModelConnectionRegistry } from './model-connection-registry.js'

/** Destructive fixtures make the user's reference and pending-credential decisions explicit. */
export async function prepareExplicitProviderRemoval(registry: ModelConnectionRegistry, providerId: string,
  expectedRevision: number, cancelPendingCredential = false) {
  await registry.assertRevision(expectedRevision)
  let snapshot = await registry.snapshot()
  if ((await registry.configurationSnapshot()).defaultProviderId === providerId) {
    const preview = await registry.previewConfiguration({ expectedRevision: snapshot.revision,
      operations: [{ kind: 'set-default-selection' }] })
    await registry.commitConfiguration({ expectedRevision: preview.expectedRevision,
      previewId: preview.previewId, idempotencyKey: `fixture-clear-selection:${preview.previewId}` })
    snapshot = await registry.snapshot()
  }
  if (cancelPendingCredential) snapshot = await registry.clearCredential(providerId, snapshot.revision)
  return snapshot
}
