import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { GatewayLaunchProfileService } from './gateway-launch-profile-service'

const roots: string[] = []
const selection = { clientId: 'codex' as const, baseUrl: 'http://127.0.0.1:18899', modelId: 'coding' }
function fixture() { const root = mkdtempSync(join(tmpdir(), 'kun-gateway-profile-')); roots.push(root); return { root, service: new GatewayLaunchProfileService() } }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('isolated launch profiles', () => {
  it('does no writes until explicit apply and restores a newly-created profile', () => {
    const { root, service } = fixture()
    const preview = service.preview(root, selection)
    expect(existsSync(join(root, '.kun-gateway'))).toBe(false)
    expect(preview.before).toBe('')
    const applied = service.apply(preview.planId)
    expect(applied.applied).toBe(true)
    expect(readFileSync(preview.path, 'utf8')).toBe(preview.after)
    service.restore(preview.planId)
    expect(existsSync(preview.path)).toBe(false)
    expect(existsSync(join(root, '.codex'))).toBe(false)
  })
  it('backs up only generated content and restores it after a second apply, including after service restart', () => {
    const { root, service } = fixture()
    const first = service.preview(root, selection)
    service.apply(first.planId)
    const second = service.preview(root, { ...selection, modelId: 'fast' })
    service.apply(second.planId)
    expect(readFileSync(`${second.path}.kun-backup`, 'utf8')).toBe(first.after)
    const restarted = new GatewayLaunchProfileService()
    const review = restarted.preview(root, { ...selection, modelId: 'fast' })
    expect(review.canRestore).toBe(true)
    restarted.restore(review.planId)
    expect(readFileSync(second.path, 'utf8')).toBe(first.after)
  })
  it('rejects duplicate apply and preserves the original backup for a no-op profile apply', () => {
    const { root, service } = fixture()
    const first = service.preview(root, selection); service.apply(first.planId)
    const second = service.preview(root, { ...selection, modelId: 'fast' }); service.apply(second.planId)
    expect(() => service.apply(second.planId)).toThrow('already applied')
    const same = service.preview(root, { ...selection, modelId: 'fast' }); service.apply(same.planId)
    expect(readFileSync(`${same.path}.kun-backup`, 'utf8')).toBe(first.after)
    service.restore(same.planId)
    expect(readFileSync(same.path, 'utf8')).toBe(first.after)
  })
  it('rejects unowned files and never reveals them in a preview', () => {
    const { root, service } = fixture()
    const dir = join(root, '.kun-gateway', 'codex'); mkdirSync(dir, { recursive: true })
    const path = join(dir, 'config.toml'); writeFileSync(path, 'unrelated-user-secret')
    expect(() => service.preview(root, selection)).toThrow('not a Kun-owned')
    expect(readFileSync(path, 'utf8')).toBe('unrelated-user-secret')
  })
  it('protects apply and restore against edits after preview', () => {
    const { root, service } = fixture()
    const first = service.preview(root, selection); service.apply(first.planId)
    const second = service.preview(root, { ...selection, modelId: 'fast' })
    writeFileSync(second.path, 'user edit')
    expect(() => service.apply(second.planId)).toThrow('changed since preview')
    expect(() => service.restore(first.planId)).toThrow('changed since preview')
    expect(readFileSync(second.path, 'utf8')).toBe('user edit')
  })
  it('refuses symbolic-link directories and backup files', () => {
    const { root, service } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'kun-gateway-outside-')); roots.push(outside)
    symlinkSync(outside, join(root, '.kun-gateway'), 'dir')
    expect(() => service.preview(root, selection)).toThrow('link')
    rmSync(join(root, '.kun-gateway'))
    const first = service.preview(root, selection); service.apply(first.planId)
    symlinkSync(join(root, 'missing'), `${first.path}.kun-backup`)
    expect(() => service.preview(root, selection)).toThrow('without links')
  })
  it('invalidates stale or unknown preview tokens', () => {
    const { service } = fixture()
    expect(() => service.apply('unknown')).toThrow('expired')
  })
})
