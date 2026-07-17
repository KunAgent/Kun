import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type {
  DesignLibrary,
  DesignLibraryMetadata,
  DesignComponent,
  DesignAsset,
  DesignComponentSearch,
  DesignAssetSearch
} from '../contracts/design-library-types.js'
import {
  DesignLibraryMetadataSchema,
  DesignComponentSearchSchema,
  DesignAssetSearchSchema
} from '../contracts/design-library-types.js'

export interface DesignLibraryServiceOptions {
  librariesRoot: string
  autoScan?: boolean
}

export class DesignLibraryService {
  private readonly librariesRoot: string
  private readonly libraries = new Map<string, DesignLibrary>()
  private readonly components = new Map<string, DesignComponent>()
  private readonly assets = new Map<string, DesignAsset>()

  constructor(options: DesignLibraryServiceOptions) {
    this.librariesRoot = options.librariesRoot
    // Don't auto-scan in constructor - let feature init await it explicitly
  }

  async scanLibraries(): Promise<void> {
    try {
      const entries = await readdir(this.librariesRoot, { withFileTypes: true })
      const dirs = entries.filter((e) => e.isDirectory())

      for (const dir of dirs) {
        try {
          await this.loadLibrary(dir.name)
        } catch (err) {
          console.warn(`Failed to load design library ${dir.name}:`, err)
        }
      }
    } catch (err) {
      console.error('Failed to scan design libraries:', err)
    }
  }

  async loadLibrary(libraryId: string): Promise<DesignLibrary> {
    const libraryPath = join(this.librariesRoot, libraryId)

    try {
      const { metadata, metadataPath } = await this.loadLibraryMetadata(libraryPath, libraryId)

      const library: DesignLibrary = {
        ...metadata,
        path: libraryPath,
        manifestPath: metadataPath,
        componentsCount: 0,
        assetsCount: 0,
        enabled: true,
        loadedAt: new Date().toISOString(),
        validationErrors: []
      }

      // Load components
      const componentsDir = join(libraryPath, 'components')
      try {
        const componentFiles = (await this.findJsonFiles(componentsDir))
          .filter((file) => basename(file).toLowerCase() !== 'index.json')
        for (const file of componentFiles) {
          try {
            const component = await this.loadComponent(library.id, file)
            this.components.set(component.id, component)
            library.componentsCount++
          } catch (err) {
            library.validationErrors.push(`Component ${file}: ${String(err)}`)
          }
        }
        if (componentFiles.length === 0) {
          const indexed = await this.loadLegacyComponentIndex(library.id, join(componentsDir, 'index.json'))
          for (const component of indexed) {
            this.components.set(component.id, component)
            library.componentsCount++
          }
        }
      } catch {
        // Components dir optional
      }

      // Load assets
      const assetsDir = join(libraryPath, 'assets')
      try {
        const assetFiles = await this.findJsonFiles(assetsDir)
        for (const file of assetFiles) {
          try {
            const asset = await this.loadAsset(library.id, file)
            this.assets.set(asset.id, asset)
            library.assetsCount++
          } catch (err) {
            library.validationErrors.push(`Asset ${file}: ${String(err)}`)
          }
        }
      } catch {
        // Assets dir optional
      }

      this.libraries.set(library.id, library)
      return library
    } catch (err) {
      throw new Error(`Failed to load library ${libraryId}: ${String(err)}`)
    }
  }

  private async loadLibraryMetadata(
    libraryPath: string,
    libraryId: string
  ): Promise<{ metadata: DesignLibraryMetadata; metadataPath: string }> {
    const manifestPath = join(libraryPath, 'manifest.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      return {
        metadata: DesignLibraryMetadataSchema.parse(manifest),
        metadataPath: manifestPath
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const metadataPath = join(libraryPath, 'metadata.json')
    const legacy = JSON.parse(await readFile(metadataPath, 'utf-8')) as Record<string, unknown>
    return {
      metadata: DesignLibraryMetadataSchema.parse({
        id: typeof legacy.id === 'string' && legacy.id.trim() ? legacy.id : libraryId,
        name: typeof legacy.name === 'string' && legacy.name.trim() ? legacy.name : libraryId,
        version: typeof legacy.version === 'string' && legacy.version.trim() ? legacy.version : '1.0.0',
        description: typeof legacy.description === 'string' ? legacy.description : '',
        author: typeof legacy.author === 'string' ? legacy.author : '',
        license: typeof legacy.license === 'string' ? legacy.license : '',
        tags: Array.isArray(legacy.tags) ? legacy.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        category: 'design-system'
      }),
      metadataPath
    }
  }

  private async loadLegacyComponentIndex(
    libraryId: string,
    indexPath: string
  ): Promise<DesignComponent[]> {
    const index = JSON.parse(await readFile(indexPath, 'utf-8')) as Record<string, unknown>
    if (!Array.isArray(index.components)) return []
    const now = new Date().toISOString()
    return index.components.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const value = entry as Record<string, unknown>
      const slug = typeof value.slug === 'string' ? value.slug.trim() : ''
      const name = typeof value.name === 'string' ? value.name.trim() : ''
      if (!slug || !name) return []
      return [{
        id: `${libraryId}/${slug}`,
        libraryId,
        name,
        displayName: typeof value.nameEn === 'string' && value.nameEn.trim() ? value.nameEn : name,
        description: typeof value.summary === 'string' ? value.summary : '',
        category: typeof value.category === 'string' ? value.category : 'general',
        tags: [],
        framework: 'universal' as const,
        props: [],
        variants: [],
        usage: '',
        examples: [],
        dependencies: [],
        a11yNotes: '',
        bestPractices: [],
        createdAt: now,
        updatedAt: now
      }]
    })
  }

  private async findJsonFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        const nested = await this.findJsonFiles(fullPath)
        results.push(...nested)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        results.push(fullPath)
      }
    }

    return results
  }

  private async loadComponent(libraryId: string, filePath: string): Promise<DesignComponent> {
    const content = await readFile(filePath, 'utf-8')
    const json = JSON.parse(content)
    const now = new Date().toISOString()

    return {
      id: json.id || `${libraryId}/${json.slug || basename(filePath, '.json')}`,
      libraryId,
      name: json.name,
      displayName: json.displayName || json.name,
      description: json.description || json.summary || '',
      category: json.category || 'general',
      tags: json.tags || [],
      framework: json.framework || 'universal',
      props: json.props || [],
      variants: json.variants || [],
      usage: json.usage || '',
      examples: json.examples || [],
      previewUrl: json.previewUrl,
      docsUrl: json.docsUrl,
      sourceUrl: json.sourceUrl,
      dependencies: json.dependencies || [],
      a11yNotes: json.a11yNotes || '',
      bestPractices: json.bestPractices || [],
      createdAt: json.createdAt || now,
      updatedAt: json.updatedAt || now
    }
  }

  private async loadAsset(libraryId: string, filePath: string): Promise<DesignAsset> {
    const content = await readFile(filePath, 'utf-8')
    const json = JSON.parse(content)
    const now = new Date().toISOString()

    let sizeBytes = 0
    if (json.path) {
      try {
        const assetPath = join(this.librariesRoot, libraryId, json.path)
        const stats = await stat(assetPath)
        sizeBytes = stats.size
      } catch {
        // Size optional
      }
    }

    return {
      id: json.id || `${libraryId}/${basename(filePath, '.json')}`,
      libraryId,
      name: json.name,
      type: json.type,
      category: json.category || 'general',
      tags: json.tags || [],
      path: json.path,
      url: json.url,
      format: json.format || '',
      sizeBytes,
      dimensions: json.dimensions,
      metadata: json.metadata || {},
      usage: json.usage || '',
      license: json.license || '',
      createdAt: json.createdAt || now,
      updatedAt: json.updatedAt || now
    }
  }

  listLibraries(): DesignLibrary[] {
    return Array.from(this.libraries.values())
  }

  getLibrary(libraryId: string): DesignLibrary | undefined {
    return this.libraries.get(libraryId)
  }

  searchComponents(search: DesignComponentSearch): DesignComponent[] {
    const validated = DesignComponentSearchSchema.parse(search)
    let results = Array.from(this.components.values())

    if (validated.libraryId) {
      results = results.filter((c) => c.libraryId === validated.libraryId)
    }

    if (validated.query) {
      const q = validated.query.toLowerCase()
      results = results.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.displayName.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q)
      )
    }

    if (validated.category) {
      results = results.filter((c) => c.category === validated.category)
    }

    if (validated.framework) {
      results = results.filter((c) => c.framework === validated.framework || c.framework === 'universal')
    }

    if (validated.tags.length > 0) {
      results = results.filter((c) => validated.tags.some((tag) => c.tags.includes(tag)))
    }

    return results.slice(validated.offset, validated.offset + validated.limit)
  }

  getComponent(componentId: string): DesignComponent | undefined {
    return this.components.get(componentId)
  }

  searchAssets(search: DesignAssetSearch): DesignAsset[] {
    const validated = DesignAssetSearchSchema.parse(search)
    let results = Array.from(this.assets.values())

    if (validated.libraryId) {
      results = results.filter((a) => a.libraryId === validated.libraryId)
    }

    if (validated.query) {
      const q = validated.query.toLowerCase()
      results = results.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.usage.toLowerCase().includes(q)
      )
    }

    if (validated.type) {
      results = results.filter((a) => a.type === validated.type)
    }

    if (validated.category) {
      results = results.filter((a) => a.category === validated.category)
    }

    if (validated.tags.length > 0) {
      results = results.filter((a) => validated.tags.some((tag) => a.tags.includes(tag)))
    }

    return results.slice(validated.offset, validated.offset + validated.limit)
  }

  getAsset(assetId: string): DesignAsset | undefined {
    return this.assets.get(assetId)
  }

  async reloadLibrary(libraryId: string): Promise<DesignLibrary> {
    // Clear existing data for this library
    this.libraries.delete(libraryId)
    for (const [id, component] of this.components) {
      if (component.libraryId === libraryId) {
        this.components.delete(id)
      }
    }
    for (const [id, asset] of this.assets) {
      if (asset.libraryId === libraryId) {
        this.assets.delete(id)
      }
    }

    return this.loadLibrary(libraryId)
  }
}
