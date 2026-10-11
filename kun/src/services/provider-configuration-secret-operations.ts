import { previewProviderRegistryDowngrade, exportProviderRegistryDowngrade } from './provider-registry-recovery.js'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ProviderConfigurationCommitRequestSchema } from '../contracts/provider-configuration.js'
import { ProviderSecretBindingSchema, decryptProviderBackup, encryptProviderBackup,
  type ProviderSecretBinding } from './provider-configuration-backup.js'
import { readProviderGeneratedHeaders } from './provider-protected-headers.js'
import { applyOperations } from './provider-configuration-operations.js'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'
import { exportProviderConfiguration, prepareProviderImport } from './provider-configuration-exchange.js'
import { type ModelConnectionRegistry, emptyDocument, appendCredentialRefs,
  credentialReferenceIsLive } from './model-connection-registry-core.js'

export type PreparedImportBinding = { connectionId: string; kind: 'credential' | 'headers'; reference: string; names?: string[]; headerClass?: 'custom' | 'adapter'; accountId?: string }
const ImportCommit = ProviderConfigurationCommitRequestSchema.extend({ bindings: z.array(ProviderSecretBindingSchema).max(1_000).default([]) })
export const providerConfigurationSecretOperations = {
  async previewProviderRecovery(this: ModelConnectionRegistry) { return previewProviderRegistryDowngrade(await this['file'].read(emptyDocument)) },
  async exportProviderRecovery(this: ModelConnectionRegistry, expectedRevision: number) {
    return exportProviderRegistryDowngrade(await this['file'].read(emptyDocument), expectedRevision)
  },
  async previewProviderImport(this: ModelConnectionRegistry, raw: unknown) {
    const snapshot = await this.configurationSnapshot(), imported = prepareProviderImport(raw, snapshot)
    const preview = await this.previewConfiguration({ expectedRevision: imported.expectedRevision, operations: imported.operations })
    const stored = this['configurationPreviews'].get(preview.previewId)!
    stored.secretSlots = imported.secretSlots
    return { ...preview, remaps: imported.remaps, secretSlots: imported.secretSlots }
  },
  async exportProviderBackup(this: ModelConnectionRegistry, password: unknown) {
    const exchange = exportProviderConfiguration(await this.configurationSnapshot())
    const bindings: ProviderSecretBinding[] = [], missingSlots: string[] = []
    for (const slot of exchange.secretSlots) {
      if (slot.kind === 'credential') {
        const credential = await this.credentialForCompatibility(slot.connectionId)
        if (credential) bindings.push({ slotId: slot.id, kind: 'credential', credential })
        else missingSlots.push(slot.id)
      } else {
        const headers = slot.headerClass === 'adapter' ? await readProviderGeneratedHeaders(this, (await this['file'].read(emptyDocument)).profiles[slot.connectionId]!) : await this.getCustomHeaders(slot.connectionId)
        bindings.push({ slotId: slot.id, kind: 'headers', headers })
      }
    }
    return { backup: await encryptProviderBackup(exchange, bindings, password), missingSlots }
  },
  async previewProviderBackup(this: ModelConnectionRegistry, raw: unknown) {
    const input = z.object({ expectedRevision: z.number().int().nonnegative(), password: z.string().min(12).max(1_024), backup: z.unknown() }).strict().parse(raw)
    const payload = await decryptProviderBackup(input.backup, input.password)
    if (!payload.exchange || typeof payload.exchange !== 'object' || Array.isArray(payload.exchange)) throw new Error('Invalid provider backup configuration')
    const preview = await this.previewProviderImport({ ...payload.exchange, expectedRevision: input.expectedRevision })
    const secrets = this['configurationImportSecrets']
    let bytes = [...secrets.values()].reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), Buffer.byteLength(JSON.stringify(payload.bindings)))
    while (bytes > 16 * 1024 * 1024 && secrets.size) {
      const oldest = secrets.keys().next().value!
      bytes -= Buffer.byteLength(JSON.stringify(secrets.get(oldest)))
      secrets.delete(oldest); this['configurationPreviews'].delete(oldest)
    }
    this['configurationImportSecrets'].set(preview.previewId, payload.bindings)
    const expiry = setTimeout(() => this['configurationImportSecrets'].delete(preview.previewId), Math.max(1, Date.parse(preview.expiresAt) - Date.now()))
    expiry.unref?.()
    return { ...preview, secretSlots: preview.secretSlots.map((slot) => ({ ...slot,
      bound: payload.bindings.some((binding) => binding.slotId === slot.id && binding.kind === slot.kind) })) }
  },
  async commitProviderImport(this: ModelConnectionRegistry, raw: unknown) {
    if (Buffer.byteLength(JSON.stringify(raw)) > 8 * 1024 * 1024) throw new Error('Import bindings exceed the 8 MiB limit')
    const input = ImportCommit.parse(raw), commit = ProviderConfigurationCommitRequestSchema.parse({
      expectedRevision: input.expectedRevision, previewId: input.previewId, idempotencyKey: input.idempotencyKey })
    const bindingDigest = createHash('sha256').update(JSON.stringify(input.bindings)).digest('hex')
    const existing = await this['file'].read(emptyDocument)
    const receipt = existing.configuration.commits[input.idempotencyKey]
    if (receipt) {
      if (!receipt.digest.endsWith(`:${bindingDigest}`)) throw new Error('Idempotency key was committed with different secret bindings')
      return this.commitConfiguration(commit)
    }
    const preview = this['configurationPreviews'].get(input.previewId)
    if (!preview || !preview.secretSlots || Date.parse(preview.expiresAt) <= Date.now()) throw new Error('Import preview expired; review the document again')
    const bindings = new Map<string, ProviderSecretBinding>()
    for (const binding of [...(this['configurationImportSecrets'].get(input.previewId) ?? []), ...input.bindings]) bindings.set(binding.slotId, binding)
    if (new Set(input.bindings.map((entry) => entry.slotId)).size !== input.bindings.length) throw new Error('Duplicate secret slot binding')
    const prepared: PreparedImportBinding[] = []
    const writes: Array<{ reference: string; value: string }> = []
    for (const [slotId, binding] of bindings) {
      const slot = preview.secretSlots.find((entry) => entry.id === slotId)
      if (!slot || slot.kind !== binding.kind) throw new Error('Secret binding does not match an imported slot')
      if (binding.kind === 'headers' && JSON.stringify(Object.keys(binding.headers).sort()) !== JSON.stringify([...(slot.names ?? [])].sort())) {
        throw new Error('Header binding names must exactly match the reviewed slot')
      }
      let credential = binding.kind === 'credential' ? binding.credential : undefined
      let accountId: string | undefined
      if (binding.kind === 'credential' && binding.sourceConnectionId) {
        const source = existing.profiles[binding.sourceConnectionId]
        const projected = applyOperations(existing, preview.operations)
        const target = projected.profiles[slot.connectionId]
        const sourceEffective = source && effectiveProviderConfiguration(source, existing.configuration)
        const targetEffective = target && effectiveProviderConfiguration(target, projected.configuration)
        const sourceProfile = sourceEffective?.profile, targetProfile = targetEffective?.profile
        const hosts = (config: { baseUrl?: string; endpoints?: Record<string, string | undefined> } | undefined) =>
          new Set([config?.baseUrl, ...Object.values(config?.endpoints ?? {})].filter((url): url is string => Boolean(url)).map((url) => new URL(url).host))
        const sourceHosts = hosts(sourceProfile), targetHosts = hosts(targetProfile)
        if (!source || !target || source.authType !== target.authType || source.kind !== target.kind ||
          source.presetSource !== target.presetSource || !sourceHosts.size || !targetHosts.size || [...targetHosts].some((host) => !sourceHosts.has(host)) ||
          JSON.stringify(sourceEffective?.authProfile) !== JSON.stringify(targetEffective?.authProfile) ||
          JSON.stringify(sourceEffective?.discovery) !== JSON.stringify(targetEffective?.discovery)) {
          throw new Error('Existing secret binding requires the same credential owner, adapter and endpoint host scope')
        }
        credential = await this.credentialForCompatibility(source.id) ?? undefined
        if (!credential) throw new Error('Selected account credential is unavailable')
        accountId = source.accountId
      }
      const reference = `cred_import-${randomUUID()}`
      prepared.push({ connectionId: slot.connectionId, kind: binding.kind, reference, ...(slot.headerClass ? { headerClass: slot.headerClass } : {}), ...(accountId ? { accountId } : {}),
        ...(binding.kind === 'headers' ? { names: Object.keys(binding.headers) } : {}) })
      writes.push({ reference, value: binding.kind === 'credential' ? credential! : JSON.stringify(binding.headers) })
    }
    if (!preview.digest.endsWith(`:${bindingDigest}`)) {
      if (preview.digest.includes(':')) throw new Error('This import preview was already prepared with different secret bindings')
      preview.digest = `${preview.digest}:${bindingDigest}`
    }
    // Prepared references are durable before a vault mutation; a crashed writer cannot orphan an untracked secret.
    await this['file'].update(emptyDocument, (current) => {
      if (current.revision !== input.expectedRevision) throw new Error('Provider configuration changed; review the import again')
      for (const entry of prepared) current.credentialRefCleanup = appendCredentialRefs(current.credentialRefCleanup,
        Date.now(), entry.reference, this['registryInstanceId'], process.pid)
      return current
    })
    try {
      for (const write of writes) await this['options'].credentials.set(write.reference, { apiKey: write.value })
      const result = await this.commitConfiguration(commit, prepared)
      this['configurationImportSecrets'].delete(input.previewId)
      return result
    } finally {
      try {
        await this['file'].update(emptyDocument, (current) => {
          for (const entry of prepared) {
            if (credentialReferenceIsLive(current, entry.reference)) delete current.credentialRefCleanup[entry.reference]
            else current.credentialRefCleanup[entry.reference] = { reference: entry.reference, enqueuedAt: Date.now() }
          }
          return current
        })
        await this['drainCredentialRefCleanup']()
      } catch { /* The durable journal remains authoritative until Manager recovery. */ }
    }
  }
}
