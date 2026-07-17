import { designApi } from '@shared/seam/api'
import type { DesignContextContribution } from './design-context-contribution'

type Library = { id: string; name: string; version: string; description?: string }
type Skill = { id: string; name: string; version?: string; description?: string }
type Component = { id: string; displayName?: string; name: string; description?: string; updatedAt?: string }
type Asset = { id: string; name: string; usage?: string; updatedAt?: string }

export async function loadDesignContextContributions(): Promise<DesignContextContribution[]> {
  const [librariesResult, skillsResult, componentsResult, assetsResult] = await Promise.all([
    designApi.listLibraries(),
    designApi.listSkills(),
    designApi.searchComponents({ query: '', tags: [], limit: 200, offset: 0 }),
    designApi.searchAssets({ query: '', tags: [], limit: 200, offset: 0 })
  ])
  const libraries = (librariesResult.libraries as Library[] | undefined) ?? []
  const skills = (skillsResult.skills as Skill[] | undefined) ?? []
  const components = (componentsResult.components as Component[] | undefined) ?? []
  const assets = (assetsResult.assets as Asset[] | undefined) ?? []
  return [
    ...libraries.map((item): DesignContextContribution => ({
      id: `system:${item.id}`,
      kind: 'design-system',
      title: item.name,
      summary: item.description?.trim() || `Design system ${item.name}`,
      version: item.version,
      loadDetail: async () => item
    })),
    ...skills.map((item): DesignContextContribution => ({
      id: `skill:${item.id}`,
      kind: 'skill',
      title: item.name,
      summary: item.description?.trim() || `Design skill ${item.name}`,
      version: item.version ?? '1',
      loadDetail: () => designApi.getSkill(item.id)
    })),
    ...components.map((item): DesignContextContribution => ({
      id: `component:${item.id}`,
      kind: 'component',
      title: item.displayName?.trim() || item.name,
      summary: item.description?.trim() || `Component ${item.name}`,
      version: item.updatedAt ?? '1',
      loadDetail: async () => item
    })),
    ...assets.map((item): DesignContextContribution => ({
      id: `asset:${item.id}`,
      kind: 'asset',
      title: item.name,
      summary: item.usage?.trim() || `Design asset ${item.name}`,
      version: item.updatedAt ?? '1',
      loadDetail: async () => item
    }))
  ].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}
