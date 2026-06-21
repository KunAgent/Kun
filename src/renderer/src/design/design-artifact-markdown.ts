import type { DesignArtifact } from './design-types'

type SelectedContextLine = {
  kind?: string
  label: string
  detail?: string
}

export type BuildDesignArtifactMarkdownOptions = {
  artifact: DesignArtifact
  designMdPath: string
  currentTurn: string
  selectedContext?: readonly SelectedContextLine[]
  updatedAt?: string
}

function fallback(value: string | undefined, empty = 'TBD'): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : empty
}

function originalBrief(artifact: DesignArtifact): string {
  return fallback(artifact.versions[artifact.versions.length - 1]?.summary, artifact.title)
}

function versionLabel(artifact: DesignArtifact): string {
  return `v${Math.max(1, artifact.versions.length)}`
}

function formatSelectedContext(context: readonly SelectedContextLine[] | undefined): string {
  if (!context || context.length === 0) return '- None'
  return context
    .map((item) => {
      const prefix = item.kind ? `[${item.kind}] ` : ''
      const detail = item.detail ? ` - ${item.detail}` : ''
      return `- ${prefix}${fallback(item.label, 'Selection')}${detail}`
    })
    .join('\n')
}

export function buildDesignArtifactMarkdown(options: BuildDesignArtifactMarkdownOptions): string {
  const { artifact, designMdPath, currentTurn } = options
  const updatedAt = options.updatedAt ?? new Date().toISOString()
  const currentVersion = artifact.versions[0]
  const versionRows =
    artifact.versions.length > 0
      ? artifact.versions
          .map((version, index) => {
            const label = `v${artifact.versions.length - index}`
            return `- ${label}: \`${version.relativePath}\` - ${fallback(version.summary, 'No summary')}`
          })
          .join('\n')
      : '- v1: No version history yet'

  return `# Design Notes: ${fallback(artifact.title, artifact.id)}

- Artifact id: \`${artifact.id}\`
- Source HTML path: \`${artifact.relativePath}\`
- Design notes file: \`${designMdPath}\`
- Latest version: ${versionLabel(artifact)}${currentVersion ? ` (\`${currentVersion.relativePath}\`)` : ''}
- Updated: ${updatedAt}

## Original Brief

${originalBrief(artifact)}

## Current User Turn

${fallback(currentTurn, 'No current turn recorded.')}

## Selected Context

${formatSelectedContext(options.selectedContext)}

## Visual Direction

- Establish the page layout, hierarchy, color system, typography, spacing, and responsive behavior for this screen.
- Keep visual decisions consistent with \`.kun-design/DESIGN_SYSTEM.md\` when that shared file exists.

## Interaction Notes

- Document important states, inputs, navigation, animation, and accessibility behavior here as the design evolves.

## Handoff Notes

- Keep the HTML file standalone and implementation-ready.
- Note any assumptions or follow-up work that code mode should preserve.

## Version History

${versionRows}
`
}
