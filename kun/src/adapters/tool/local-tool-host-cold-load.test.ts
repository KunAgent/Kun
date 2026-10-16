import { expect, it } from 'vitest'

// This isolated file must not preload the runtime/Room tool barrel before the low-level tool entry.
it('cold-loads file tools before the tool host and preserves shared Room authority exports', async () => {
  const files = await import('./builtin-file-tools.js')
  expect(files.createWriteLocalTool().name).toBe('write')
  const core = await import('./local-tool-host-core.js')
  expect(typeof core.LocalToolHost.defineTool).toBe('function')
  const [leaf, legacy] = await Promise.all([
    import('../../rooms/room-peer-store-binding.js'), import('../../rooms/room-peer-tools.js')
  ])
  expect(legacy.bindRoomPeerStore).toBe(leaf.bindRoomPeerStore)
  expect(legacy.roomPeerStoreBinding).toBe(leaf.roomPeerStoreBinding)
})
