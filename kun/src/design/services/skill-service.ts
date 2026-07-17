import { readdir, readFile } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import type {
  RuntimeSkill,
  StaticSkill,
  SkillSearch,
  SkillExecutionContext,
  SkillExecutionResult
} from '../contracts/skill-types.js'
import { SkillSearchSchema } from '../contracts/skill-types.js'

export interface SkillServiceOptions {
  runtimeSkillsRoot: string
  staticSkillsRoot: string
  autoScan?: boolean
}

export class SkillService {
  private readonly runtimeSkillsRoot: string
  private readonly staticSkillsRoot: string
  private readonly runtimeSkills = new Map<string, RuntimeSkill>()
  private readonly staticSkills = new Map<string, StaticSkill>()

  constructor(options: SkillServiceOptions) {
    this.runtimeSkillsRoot = options.runtimeSkillsRoot
    this.staticSkillsRoot = options.staticSkillsRoot
    // Don't auto-scan in constructor - let feature init await it explicitly
  }

  async scanSkills(): Promise<void> {
    await Promise.all([
      this.scanRuntimeSkills(),
      this.scanStaticSkills()
    ])
  }

  private async scanRuntimeSkills(): Promise<void> {
    try {
      const files = await this.findMarkdownFiles(this.runtimeSkillsRoot)
      for (const file of files) {
        try {
          await this.loadRuntimeSkill(file)
        } catch (err) {
          console.warn(`Failed to load runtime skill ${file}:`, err)
        }
      }
    } catch (err) {
      console.error('Failed to scan runtime skills:', err)
    }
  }

  private async scanStaticSkills(): Promise<void> {
    try {
      const files = await this.findMarkdownFiles(this.staticSkillsRoot)
      for (const file of files) {
        try {
          await this.loadStaticSkill(file)
        } catch (err) {
          console.warn(`Failed to load static skill ${file}:`, err)
        }
      }
    } catch (err) {
      console.error('Failed to scan static skills:', err)
    }
  }

  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    try {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          const nested = await this.findMarkdownFiles(fullPath)
          results.push(...nested)
        } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
          results.push(fullPath)
        }
      }
    } catch {
      // Directory might not exist
    }

    return results
  }

  private async loadRuntimeSkill(filePath: string): Promise<RuntimeSkill> {
    const content = await readFile(filePath, 'utf-8')
    const metadata = this.parseSkillMetadata(content, filePath)
    const sections = this.parseSections(content)
    const codeExamples = this.parseCodeExamples(content)
    const references = this.parseReferences(content)

    const skill: RuntimeSkill = {
      ...metadata,
      path: filePath,
      content,
      format: filePath.endsWith('.mdx') ? 'mdx' : 'markdown',
      sections,
      codeExamples,
      references,
      loadedAt: new Date().toISOString()
    }

    this.runtimeSkills.set(skill.id, skill)
    return skill
  }

  private async loadStaticSkill(filePath: string): Promise<StaticSkill> {
    const name = basename(filePath, extname(filePath))
    const id = this.generateSkillId(filePath, this.staticSkillsRoot)

    const skill: StaticSkill = {
      id,
      name: this.formatName(name),
      path: filePath,
      category: this.inferCategory(filePath),
      tags: [],
      description: '',
      format: filePath.endsWith('.mdx') ? 'mdx' : 'markdown'
    }

    this.staticSkills.set(skill.id, skill)
    return skill
  }

  private parseSkillMetadata(content: string, filePath: string): Omit<RuntimeSkill, 'path' | 'content' | 'format' | 'sections' | 'codeExamples' | 'references' | 'loadedAt'> {
    const lines = content.split('\n')
    const name = basename(filePath, extname(filePath))
    const id = this.generateSkillId(filePath, this.runtimeSkillsRoot)

    // Try to extract frontmatter
    let metadata: Record<string, unknown> = {}
    if (lines[0] === '---') {
      const endIndex = lines.indexOf('---', 1)
      if (endIndex > 0) {
        const frontmatter = lines.slice(1, endIndex).join('\n')
        try {
          metadata = this.parseFrontmatter(frontmatter)
        } catch {
          // Frontmatter optional
        }
      }
    }

    return {
      id,
      name: (metadata.name as string) || this.formatName(name),
      description: (metadata.description as string) || '',
      category: this.inferCategory(filePath),
      tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [],
      author: (metadata.author as string) || '',
      version: (metadata.version as string) || '1.0.0',
      difficulty: this.parseDifficulty((metadata.difficulty as string) || 'intermediate'),
      estimatedReadingMinutes: this.estimateReadingTime(content),
      prerequisites: Array.isArray(metadata.prerequisites) ? metadata.prerequisites.map(String) : [],
      relatedSkills: Array.isArray(metadata.relatedSkills) ? metadata.relatedSkills.map(String) : [],
      lastUpdated: (metadata.lastUpdated as string) || new Date().toISOString()
    }
  }

  private parseFrontmatter(frontmatter: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const lines = frontmatter.split('\n')

    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim()
        const value = line.slice(colonIndex + 1).trim()

        // Try to parse as JSON array/object
        if (value.startsWith('[') || value.startsWith('{')) {
          try {
            result[key] = JSON.parse(value)
          } catch {
            result[key] = value
          }
        } else {
          result[key] = value
        }
      }
    }

    return result
  }

  private parseSections(content: string): Array<{ title: string; level: number; content: string }> {
    const sections: Array<{ title: string; level: number; content: string }> = []
    const lines = content.split('\n')
    let currentSection: { title: string; level: number; content: string } | null = null

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        if (currentSection) {
          sections.push(currentSection)
        }
        currentSection = {
          title: match[2],
          level: match[1].length,
          content: ''
        }
      } else if (currentSection) {
        currentSection.content += line + '\n'
      }
    }

    if (currentSection) {
      sections.push(currentSection)
    }

    return sections
  }

  private parseCodeExamples(content: string): Array<{ language: string; code: string; description: string }> {
    const examples: Array<{ language: string; code: string; description: string }> = []
    const codeBlockRegex = /```(\w+)\n([\s\S]*?)```/g
    let match: RegExpExecArray | null

    while ((match = codeBlockRegex.exec(content)) !== null) {
      examples.push({
        language: match[1],
        code: match[2].trim(),
        description: ''
      })
    }

    return examples
  }

  private parseReferences(content: string): Array<{ title: string; url: string }> {
    const references: Array<{ title: string; url: string }> = []
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g
    let match: RegExpExecArray | null

    while ((match = linkRegex.exec(content)) !== null) {
      references.push({
        title: match[1],
        url: match[2]
      })
    }

    return references
  }

  private generateSkillId(filePath: string, rootDir: string): string {
    return filePath
      .replace(rootDir, '')
      .replace(/^[/\\]/, '')
      .replace(/\\/g, '/')
      .replace(/\.mdx?$/, '')
  }

  private formatName(name: string): string {
    return name
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  private inferCategory(filePath: string): 'design-patterns' | 'color-theory' | 'typography' | 'layout' | 'accessibility' | 'animation' | 'responsive' | 'branding' | 'ui-components' | 'prototyping' {
    const lower = filePath.toLowerCase()
    if (lower.includes('pattern')) return 'design-patterns'
    if (lower.includes('color')) return 'color-theory'
    if (lower.includes('typography') || lower.includes('font')) return 'typography'
    if (lower.includes('layout') || lower.includes('grid')) return 'layout'
    if (lower.includes('a11y') || lower.includes('accessibility')) return 'accessibility'
    if (lower.includes('animation') || lower.includes('motion')) return 'animation'
    if (lower.includes('responsive') || lower.includes('mobile')) return 'responsive'
    if (lower.includes('brand')) return 'branding'
    if (lower.includes('component')) return 'ui-components'
    if (lower.includes('prototype')) return 'prototyping'
    return 'design-patterns'
  }

  private parseDifficulty(value: string): 'beginner' | 'intermediate' | 'advanced' | 'expert' {
    const lower = value.toLowerCase()
    if (lower === 'beginner') return 'beginner'
    if (lower === 'advanced') return 'advanced'
    if (lower === 'expert') return 'expert'
    return 'intermediate'
  }

  private estimateReadingTime(content: string): number {
    const wordsPerMinute = 200
    const wordCount = content.split(/\s+/).length
    return Math.max(1, Math.ceil(wordCount / wordsPerMinute))
  }

  listRuntimeSkills(): RuntimeSkill[] {
    return Array.from(this.runtimeSkills.values())
  }

  listStaticSkills(): StaticSkill[] {
    return Array.from(this.staticSkills.values())
  }

  getRuntimeSkill(skillId: string): RuntimeSkill | undefined {
    return this.runtimeSkills.get(skillId)
  }

  getStaticSkill(skillId: string): StaticSkill | undefined {
    return this.staticSkills.get(skillId)
  }

  searchRuntimeSkills(search: SkillSearch): RuntimeSkill[] {
    const validated = SkillSearchSchema.parse(search)
    let results = Array.from(this.runtimeSkills.values())

    if (validated.query) {
      const q = validated.query.toLowerCase()
      results = results.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.content.toLowerCase().includes(q)
      )
    }

    if (validated.category) {
      results = results.filter((s) => s.category === validated.category)
    }

    if (validated.difficulty) {
      results = results.filter((s) => s.difficulty === validated.difficulty)
    }

    if (validated.tags.length > 0) {
      results = results.filter((s) => validated.tags.some((tag) => s.tags.includes(tag)))
    }

    return results.slice(validated.offset, validated.offset + validated.limit)
  }

  executeSkill(context: SkillExecutionContext): SkillExecutionResult {
    const skill = this.runtimeSkills.get(context.skillId)

    if (!skill) {
      return {
        skillId: context.skillId,
        success: false,
        injectedContent: '',
        error: `Skill not found: ${context.skillId}`,
        executedAt: new Date().toISOString()
      }
    }

    try {
      // Inject skill content into context
      let injectedContent = `# ${skill.name}\n\n${skill.content}`

      if (context.additionalContext && Object.keys(context.additionalContext).length > 0) {
        injectedContent += '\n\n## Context\n' + JSON.stringify(context.additionalContext, null, 2)
      }

      return {
        skillId: context.skillId,
        success: true,
        injectedContent,
        executedAt: new Date().toISOString()
      }
    } catch (err) {
      return {
        skillId: context.skillId,
        success: false,
        injectedContent: '',
        error: String(err),
        executedAt: new Date().toISOString()
      }
    }
  }

  async reloadSkills(): Promise<void> {
    this.runtimeSkills.clear()
    this.staticSkills.clear()
    await this.scanSkills()
  }
}
