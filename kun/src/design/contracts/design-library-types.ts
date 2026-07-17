import { z } from 'zod'

// ─── Design Library ───

export const DesignLibraryMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  version: z.string().default('1.0.0'),
  description: z.string().default(''),
  author: z.string().default(''),
  license: z.string().default(''),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  category: z.enum(['component-library', 'design-system', 'icon-set', 'template-kit', 'style-guide']).default('component-library')
})
export type DesignLibraryMetadata = z.infer<typeof DesignLibraryMetadataSchema>

export const DesignLibrarySchema = z.object({
  ...DesignLibraryMetadataSchema.shape,
  path: z.string().min(1),
  manifestPath: z.string().min(1),
  componentsCount: z.number().int().nonnegative().default(0),
  assetsCount: z.number().int().nonnegative().default(0),
  enabled: z.boolean().default(true),
  loadedAt: z.string(),
  validationErrors: z.array(z.string()).default([])
})
export type DesignLibrary = z.infer<typeof DesignLibrarySchema>

// ─── Design Component ───

export const ComponentVariantSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().default(''),
  props: z.record(z.string(), z.unknown()).default({}),
  previewUrl: z.string().optional(),
  code: z.string().default('')
})
export type ComponentVariant = z.infer<typeof ComponentVariantSchema>

export const ComponentPropSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  description: z.string().default('')
})
export type ComponentProp = z.infer<typeof ComponentPropSchema>

export const DesignComponentSchema = z.object({
  id: z.string().min(1),
  libraryId: z.string().min(1),
  name: z.string().min(1).max(200),
  displayName: z.string().default(''),
  description: z.string().default(''),
  category: z.string().default('general'),
  tags: z.array(z.string()).default([]),
  framework: z.enum(['react', 'vue', 'angular', 'svelte', 'html', 'universal']).default('universal'),
  props: z.array(ComponentPropSchema).default([]),
  variants: z.array(ComponentVariantSchema).default([]),
  usage: z.string().default(''),
  examples: z.array(z.string()).default([]),
  previewUrl: z.string().optional(),
  docsUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  dependencies: z.array(z.string()).default([]),
  a11yNotes: z.string().default(''),
  bestPractices: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type DesignComponent = z.infer<typeof DesignComponentSchema>

// ─── Design Asset ───

export const DesignAssetSchema = z.object({
  id: z.string().min(1),
  libraryId: z.string().min(1),
  name: z.string().min(1).max(200),
  type: z.enum(['icon', 'image', 'font', 'color-palette', 'spacing-scale', 'typography-scale', 'animation', 'illustration', 'logo']),
  category: z.string().default('general'),
  tags: z.array(z.string()).default([]),
  path: z.string().min(1),
  url: z.string().url().optional(),
  format: z.string().default(''),
  sizeBytes: z.number().int().nonnegative().default(0),
  dimensions: z.object({
    width: z.number().positive(),
    height: z.number().positive()
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  usage: z.string().default(''),
  license: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type DesignAsset = z.infer<typeof DesignAssetSchema>

// ─── Search & Filter ───

export const DesignComponentSearchSchema = z.object({
  libraryId: z.string().optional(),
  query: z.string().default(''),
  category: z.string().optional(),
  framework: z.enum(['react', 'vue', 'angular', 'svelte', 'html', 'universal']).optional(),
  tags: z.array(z.string()).default([]),
  limit: z.number().int().positive().default(50),
  offset: z.number().int().nonnegative().default(0)
})
export type DesignComponentSearch = z.infer<typeof DesignComponentSearchSchema>

export const DesignAssetSearchSchema = z.object({
  libraryId: z.string().optional(),
  query: z.string().default(''),
  type: z.enum(['icon', 'image', 'font', 'color-palette', 'spacing-scale', 'typography-scale', 'animation', 'illustration', 'logo']).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  limit: z.number().int().positive().default(50),
  offset: z.number().int().nonnegative().default(0)
})
export type DesignAssetSearch = z.infer<typeof DesignAssetSearchSchema>
