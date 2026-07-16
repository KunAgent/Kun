import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { DesignLibraryService } from './services/design-library-service.js'

describe('legacy design library compatibility', () => {
  it('loads workStone metadata and component indexes without a manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-design-library-'))
    const libraryDir = join(root, 'dl_builtin_apple')
    await mkdir(join(libraryDir, 'components'), { recursive: true })
    await writeFile(join(libraryDir, 'metadata.json'), JSON.stringify({
      id: 'dl_builtin_apple',
      name: 'Apple',
      version: ''
    }))
    await writeFile(join(libraryDir, 'components', 'index.json'), JSON.stringify({
      brandName: 'Apple',
      components: [{ slug: 'button', name: 'Button', category: 'actions', summary: 'Primary action' }]
    }))

    const service = new DesignLibraryService({ librariesRoot: root })
    await service.scanLibraries()

    expect(service.listLibraries()).toEqual([
      expect.objectContaining({ id: 'dl_builtin_apple', name: 'Apple', componentsCount: 1 })
    ])
    expect(service.getComponent('dl_builtin_apple/button')).toMatchObject({
      name: 'Button',
      category: 'actions',
      description: 'Primary action'
    })
  })
})
