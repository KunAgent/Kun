import { DESIGN_SYSTEM_DISPLAY, formatDesignContextLines, type DesignContext } from './design-context'
import type { DesignArtifact } from './design-types'
import type {
  ComponentDef,
  ComponentSlot,
  ComponentSlotKind,
  DesignSystem,
  DesignToken,
  DesignTokenKind,
  TextStyleSpec
} from './canvas/design-system-types'
import { resolvePrototypeViewportFrame } from './prototype-player'

/** Project-level Kun handoff. Root DESIGN.md is the canonical theme source. */
export const STITCH_DESIGN_MD_PATH = '.kun-design/HANDOFF.md'

export type BuildStitchDesignMarkdownOptions = {
  title?: string
  brief?: string
  designContext?: DesignContext
  designSystem?: DesignSystem
  designSystemMdPath?: string
  projectBriefPath?: string
  artifacts?: readonly DesignArtifact[]
  updatedAt?: string
}

export type ImportedDesignMarkdown = {
  title: string
  designGuidelines: string
  sections: Record<string, string>
}

export type ImportedStitchDesign = {
  title: string
  contextPatch: Partial<DesignContext>
  tokens: DesignToken[]
  components: ImportedDesignComponentHint[]
  sections: Record<string, string>
}

export type ImportedDesignComponentHint = {
  name: string
  rootShapeCount?: number
  slots: ComponentSlot[]
  raw: string
}

function clean(value: string | undefined): string {
  return value?.trim() ?? ''
}

function code(value: string | undefined): string {
  return value ? `\`${value}\`` : '`TBD`'
}

function formatTokenValue(token: DesignToken): string {
  switch (token.kind) {
    case 'color':
      return token.value
    case 'space':
    case 'radius':
      return `${token.value}px`
    case 'type': {
      const bits: string[] = []
      if (token.value.fontFamily) bits.push(token.value.fontFamily)
      if (token.value.fontSize) bits.push(`${token.value.fontSize}px`)
      if (token.value.fontWeight) bits.push(`weight ${token.value.fontWeight}`)
      if (token.value.lineHeight) bits.push(`line ${token.value.lineHeight}`)
      if (token.value.fontColor) bits.push(token.value.fontColor)
      return bits.join(', ') || 'type style'
    }
    case 'gradient':
      return `${token.value.type} ${token.value.stops.map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`).join(', ')}`
    case 'shadow':
      return token.value
        .map((shadow) => `${shadow.type ?? 'drop'} ${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}`)
        .join('; ')
  }
}

function formatTokens(system: DesignSystem | undefined): string[] {
  const tokens = Object.values(system?.tokens ?? {})
  if (tokens.length === 0) return ['_No doc-level tokens exported yet._']
  return [
    '| Token | Kind | Value |',
    '|---|---|---|',
    ...tokens
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((token) => `| \`${token.name}\` | ${token.kind} | ${formatTokenValue(token).replaceAll('|', '\\|')} |`)
  ]
}

function componentSummary(component: ComponentDef): string {
  const slots = component.slots.length > 0
    ? component.slots.map((slot) => `${slot.path}:${slot.kind}`).join(', ')
    : 'none'
  return `- **${component.name}**: ${component.tree.length} layer${component.tree.length === 1 ? '' : 's'}; slots: ${slots}`
}

function formatComponents(system: DesignSystem | undefined): string[] {
  const components = Object.values(system?.components ?? {})
  if (components.length === 0) return ['_No reusable canvas components exported yet._']
  return components.sort((a, b) => a.name.localeCompare(b.name)).map(componentSummary)
}

function formatPrototypeLinks(artifact: DesignArtifact): string[] {
  const links = artifact.prototypeLinks ?? []
  if (links.length === 0) return []
  return links.map((link) => {
    const label = link.label ? `${link.label} -> ` : ''
    const href = link.href ? ` via ${code(link.href)}` : ''
    const target = link.targetArtifactId ? `${link.targetTitle} (${link.targetArtifactId})` : link.targetTitle
    return `  - ${label}${target}${href}`
  })
}

function formatDesignArtifacts(
  artifacts: readonly DesignArtifact[] | undefined,
  designTarget: DesignContext['designTarget']
): string[] {
  const fileArtifacts = (artifacts ?? []).filter(
    (artifact) => artifact.kind === 'html' || artifact.kind === 'svg'
  )
  if (fileArtifacts.length === 0) return ['_No HTML screens or SVG artifacts exported yet._']
  const lines: string[] = []
  for (const artifact of fileArtifacts) {
    const role = artifact.role ? `; role: ${artifact.role}` : ''
    const direction = artifact.direction ? `; direction: ${artifact.direction.name}` : ''
    if (artifact.kind === 'html') {
      const viewportFrame = resolvePrototypeViewportFrame(artifact, designTarget)
      lines.push(
        `- **${artifact.title}** (${artifact.id}): HTML ${code(artifact.relativePath)}; frame ${viewportFrame.width}x${viewportFrame.height}; notes ${code(artifact.designMdPath)}${role}${direction}`
      )
      const links = formatPrototypeLinks(artifact)
      if (links.length > 0) lines.push(...links)
      continue
    }

    const frame = artifact.node
      ? `; canvas frame ${Math.round(artifact.node.width)}x${Math.round(artifact.node.height)}`
      : ''
    lines.push(
      `- **${artifact.title}** (${artifact.id}): SVG ${code(artifact.relativePath)}${frame}; notes ${code(artifact.designMdPath)}${role}${direction}`
    )
  }
  return lines
}

export function buildStitchDesignMarkdown(options: BuildStitchDesignMarkdownOptions): string {
  const title = clean(options.title) || 'Kun design project'
  const updatedAt = options.updatedAt ?? new Date().toISOString()
  const contextLines = formatDesignContextLines(options.designContext).filter((line) => line.trim())
  const preset = options.designContext?.designSystemPreset
  const presetLine = preset && preset !== 'none' ? `- Preset: ${DESIGN_SYSTEM_DISPLAY[preset]}` : '- Preset: none'
  const referencesCanonicalTheme = options.designSystemMdPath === 'DESIGN.md'

  return [
    `# DESIGN.md: ${title}`,
    '',
    'Portable project design guide for Kun, Stitch-style workflows, and code agents.',
    '',
    '## Source',
    '',
    `- Updated: ${updatedAt}`,
    `- Project brief: ${code(options.projectBriefPath)}`,
    `- Shared token file: ${code(options.designSystemMdPath)}`,
    '- Origin: Kun design mode',
    '',
    '## Product Brief',
    '',
    clean(options.brief) || '_No project brief exported yet._',
    '',
    '## Design Context',
    '',
    presetLine,
    ...(contextLines.length > 0 ? contextLines.map((line) => (line.startsWith('- ') ? line : `- ${line}`)) : ['_No design context set yet._']),
    '',
    '## Tokens',
    '',
    ...(referencesCanonicalTheme
      ? ['See root `DESIGN.md`. Token values are intentionally not duplicated in this generated handoff.']
      : formatTokens(options.designSystem)),
    '',
    '## Components',
    '',
    ...(referencesCanonicalTheme
      ? ['See root `DESIGN.md` for public component guidance; Kun-native rich component trees remain in internal document sidecars.']
      : formatComponents(options.designSystem)),
    '',
    '## Screens and Prototype Flow',
    '',
    ...formatDesignArtifacts(options.artifacts, options.designContext?.designTarget),
    '',
    '## Implementation Guidance',
    '',
    '- Read root `DESIGN.md` first and keep UI work aligned with its tokens and component guidance plus the screen flow below.',
    '- Treat each HTML or SVG artifact DESIGN.md as the detailed handoff for states, responsive behavior, animation, and implementation notes.',
    '- Preserve planned prototype hrefs when converting HTML screens into production routes.',
    '- Keep SVG motion declarative and preserve its viewBox, accessibility metadata, and reduced-motion behavior.',
    ''
  ].join('\n')
}

export function parseStitchDesignMarkdown(raw: string): ImportedDesignMarkdown | null {
  const text = raw.trim()
  if (!text) return null
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Imported DESIGN.md'
  const sections: Record<string, string> = {}
  const sectionRe = /^##\s+(.+)$/gm
  const matches = [...text.matchAll(sectionRe)]
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]
    const name = match[1]?.trim()
    if (!name) continue
    const start = (match.index ?? 0) + match[0].length
    const end = matches[i + 1]?.index ?? text.length
    sections[name] = text.slice(start, end).trim()
  }
  const guidelineSections = [
    'Product Brief',
    'Design Context',
    'Tokens',
    'Components',
    'Screens and Prototype Flow',
    'Implementation Guidance',
    'Design Document',
    'Design Mode',
    'Design Motion',
    'Design Graph',
    'Canvas Operation Journal',
    'Code Bindings',
    'Assets',
    'Agent Contract'
  ]
  const designGuidelines = guidelineSections
    .map((name) => sections[name])
    .filter((section): section is string => Boolean(section?.trim()))
    .join('\n\n')
  return { title, designGuidelines, sections }
}

function uncode(value: string): string {
  return value.trim().replace(/^`|`$/g, '').trim()
}

function parseTokenKind(value: string): DesignTokenKind | null {
  const kind = value.trim().toLowerCase()
  if (kind === 'color' || kind === 'gradient' || kind === 'type' || kind === 'space' || kind === 'radius' || kind === 'shadow') {
    return kind
  }
  return null
}

function parseTokenNumber(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function parseTypeTokenValue(value: string): TextStyleSpec {
  const out: TextStyleSpec = {}
  for (const part of value.split(',')) {
    const item = part.trim()
    const px = item.match(/^(\d+(?:\.\d+)?)px$/i)
    if (px) {
      out.fontSize = Number(px[1])
      continue
    }
    const weight = item.match(/^weight\s+(\d+)$/i)
    if (weight) {
      out.fontWeight = Number(weight[1])
      continue
    }
    const line = item.match(/^line\s+(\d+(?:\.\d+)?)$/i)
    if (line) {
      out.lineHeight = Number(line[1])
      continue
    }
    if (/^#[0-9a-f]{6}$/i.test(item)) {
      out.fontColor = item
      continue
    }
    if (!out.fontFamily && item) out.fontFamily = item
  }
  return out
}

function parseTokenRow(line: string): DesignToken | null {
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
  if (cells.length < 3) return null
  const name = uncode(cells[0])
  const kind = parseTokenKind(cells[1])
  const value = cells[2].replaceAll('\\|', '|').trim()
  if (!name || !kind || /^---+$/.test(name) || name.toLowerCase() === 'token') return null
  switch (kind) {
    case 'color': {
      const color = value.match(/#[0-9a-f]{6}/i)?.[0]
      return color ? { name, kind, value: color } : null
    }
    case 'space':
    case 'radius': {
      const number = parseTokenNumber(value)
      return number === null ? null : { name, kind, value: number } as DesignToken
    }
    case 'type': {
      const spec = parseTypeTokenValue(value)
      return Object.keys(spec).length > 0 ? { name, kind, value: spec } : null
    }
    case 'gradient':
    case 'shadow':
      return null
  }
}

function parseImportedTokens(tokensSection: string | undefined): DesignToken[] {
  if (!tokensSection) return []
  const out: DesignToken[] = []
  for (const line of tokensSection.split('\n')) {
    const token = parseTokenRow(line)
    if (token) out.push(token)
  }
  return out
}

function parseComponentSlotKind(value: string): ComponentSlotKind | null {
  const kind = value.trim().toLowerCase()
  if (kind === 'text' || kind === 'image' || kind === 'color' || kind === 'visible') return kind
  return null
}

function parseComponentSlots(value: string): ComponentSlot[] {
  if (!value.trim() || value.trim().toLowerCase() === 'none') return []
  return value
    .split(',')
    .map((entry) => {
      const [pathRaw, kindRaw] = entry.split(':')
      const path = pathRaw?.trim()
      const kind = parseComponentSlotKind(kindRaw ?? '')
      return path && kind ? { path, kind } : null
    })
    .filter((slot): slot is ComponentSlot => Boolean(slot))
}

function parseComponentLine(line: string): ImportedDesignComponentHint | null {
  const match = line.match(/^[-*]\s+\*\*(.+?)\*\*\s*:\s*(.+)$/)
  if (!match) return null
  const name = match[1]?.trim()
  const body = match[2]?.trim() ?? ''
  if (!name) return null
  const rootShapeCount = body.match(/(\d+)\s+layer/i)?.[1]
  const slots = body.match(/\bslots\s*:\s*(.+)$/i)?.[1]
  return {
    name,
    ...(rootShapeCount ? { rootShapeCount: Number(rootShapeCount) } : {}),
    slots: parseComponentSlots(slots ?? ''),
    raw: line.trim()
  }
}

function parseImportedComponents(componentsSection: string | undefined): ImportedDesignComponentHint[] {
  if (!componentsSection) return []
  return componentsSection
    .split('\n')
    .map((line) => parseComponentLine(line.trim()))
    .filter((component): component is ImportedDesignComponentHint => Boolean(component))
}

function extractPreset(text: string): DesignContext['designSystemPreset'] | undefined {
  const lower = text.toLowerCase()
  if (lower.includes('shadcn')) return 'shadcn'
  if (lower.includes('radix')) return 'radix'
  if (lower.includes('material')) return 'material'
  if (lower.includes('ios') || lower.includes('apple')) return 'ios'
  if (lower.includes('fluent')) return 'fluent'
  if (lower.includes('ant design')) return 'ant'
  if (lower.includes('chakra')) return 'chakra'
  if (lower.includes('carbon')) return 'carbon'
  if (lower.includes('polaris')) return 'polaris'
  if (lower.includes('bootstrap')) return 'bootstrap'
  if (lower.includes('geist')) return 'geist'
  if (lower.includes('brutal')) return 'brutalism'
  if (lower.includes('editorial')) return 'editorial'
  return undefined
}

function cleanTargetLabel(value: string): string {
  return value
    .replace(/[`*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isDesignTargetFieldLabel(value: string): boolean {
  return /^(?:design\s+)?(?:target|platform|surface)$/.test(cleanTargetLabel(value))
}

function targetFromFieldValue(value: string): DesignContext['designTarget'] | undefined {
  const normalized = cleanTargetLabel(value)
  if (!normalized) return undefined
  if (
    /^(?:app|application)\b/.test(normalized) ||
    /\b(?:mobile|native)\s+app\b/.test(normalized) ||
    /\b(?:phone|ios|android)\b/.test(normalized)
  ) {
    return 'app'
  }
  if (
    /^(?:web|website|web\s+app|browser|desktop)\b/.test(normalized) ||
    /\b(?:responsive\s+web|desktop\s+web|browser|website|webpage|web-page)\b/.test(normalized)
  ) {
    return 'web'
  }
  return undefined
}

function extractDesignTarget(text: string): DesignContext['designTarget'] | undefined {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const tableCells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
    if (tableCells.length >= 2 && isDesignTargetFieldLabel(tableCells[0])) {
      const tableTarget = targetFromFieldValue(tableCells[1])
      if (tableTarget) return tableTarget
    }

    const field = line.match(/^(?:[-*]\s*)?(?:\*\*)?\s*((?:design\s+)?(?:target|platform|surface))(?:\*\*)?\s*(?::|[-=])\s*(.+)$/i)
    if (!field) continue
    const target = targetFromFieldValue(field[2] ?? '')
    if (target) return target
  }
  return undefined
}

export function importStitchDesignMarkdown(raw: string): ImportedStitchDesign | null {
  const parsed = parseStitchDesignMarkdown(raw)
  if (!parsed) return null
  const tokens = parseImportedTokens(parsed.sections.Tokens)
  const components = parseImportedComponents(parsed.sections.Components)
  const allGuidelines = parsed.designGuidelines.trim()
  const contextPatch: Partial<DesignContext> = {
    designGuidelines: allGuidelines
      ? [`Imported from ${parsed.title}:`, '', allGuidelines].join('\n')
      : undefined
  }
  const firstColor =
    parsed.sections['Design Context']?.match(/#[0-9a-f]{6}/i)?.[0] ??
    tokens.find((token) => token.kind === 'color')?.value
  if (firstColor) contextPatch.brandColor = firstColor
  const preset = extractPreset(parsed.sections['Design Context'] ?? '')
  if (preset) contextPatch.designSystemPreset = preset
  const designTarget = extractDesignTarget(parsed.sections['Design Context'] ?? '')
  if (designTarget) contextPatch.designTarget = designTarget
  return {
    title: parsed.title,
    contextPatch,
    tokens,
    components,
    sections: parsed.sections
  }
}
