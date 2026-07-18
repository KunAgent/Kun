import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionManifestSchema } from '@kun/extension-api'
import { scaffoldExtension } from '../src/scaffold.mjs'

const temporaryDirectories: string[] = []
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('create-kun-extension', () => {
  it.each([
    ['node', ['.gitignore', 'kun-extension.json', 'src/extension.ts']],
    ['webview', ['.gitignore', 'kun-extension.json', 'src/webview/index.html']],
    ['react', ['.gitignore', 'kun-extension.json', 'src/host/extension.ts', 'src/webview/main.tsx']]
  ])('creates an atomic schema-valid %s project', async (template, expectedFiles) => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-scaffold-test-'))
    temporaryDirectories.push(parent)
    const targetDirectory = join(parent, 'issue-assistant')
    const result = await scaffoldExtension({
      targetDirectory,
      publisher: 'acme',
      name: 'issue-assistant',
      displayName: 'Issue Assistant',
      template
    })
    expect(result.extensionId).toBe('acme.issue-assistant')
    expect(result.files).toEqual(expect.arrayContaining(expectedFiles))
    const manifest = JSON.parse(await readFile(join(targetDirectory, 'kun-extension.json'), 'utf8'))
    expect(ExtensionManifestSchema.safeParse(manifest).success).toBe(true)
    expect(await readFile(join(targetDirectory, '.gitignore'), 'utf8')).toContain('node_modules/')
  })

  it('validates identity before creating partial output', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-scaffold-test-'))
    temporaryDirectories.push(parent)
    const targetDirectory = join(parent, 'invalid')
    await expect(
      scaffoldExtension({
        targetDirectory,
        publisher: 'kun',
        name: 'invalid',
        template: 'node'
      })
    ).rejects.toThrow('EXT_SCAFFOLD_RESERVED_PUBLISHER')
    await expect(readFile(join(targetDirectory, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('escapes display names for JSON, TypeScript, and HTML template contexts', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kun-scaffold-test-'))
    temporaryDirectories.push(parent)
    const targetDirectory = join(parent, 'quoted-name')
    const displayName = '工具 "助手" <Beta>'
    await scaffoldExtension({
      targetDirectory,
      publisher: 'acme',
      name: 'quoted-name',
      displayName,
      template: 'webview'
    })
    const manifest = JSON.parse(await readFile(join(targetDirectory, 'kun-extension.json'), 'utf8'))
    const html = await readFile(join(targetDirectory, 'src/webview/index.html'), 'utf8')
    expect(manifest.displayName).toBe(displayName)
    expect(html).toContain('工具 &quot;助手&quot; &lt;Beta&gt;')
  })

  it('builds a framework-neutral Webview with browser-resolvable bundled assets', async () => {
    const parent = await mkdtemp(join(repositoryRoot, '.kun-scaffold-build-'))
    temporaryDirectories.push(parent)
    const targetDirectory = join(parent, 'browser-app')
    await scaffoldExtension({
      targetDirectory,
      publisher: 'acme',
      name: 'browser-app',
      displayName: 'Browser App',
      template: 'webview'
    })

    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], {
      cwd: targetDirectory,
      encoding: 'utf8',
      env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' }
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)

    const packageJson = JSON.parse(await readFile(join(targetDirectory, 'package.json'), 'utf8'))
    expect(packageJson.devDependencies.vite).toBe('^6.2.0')
    const outputRoot = join(targetDirectory, 'dist', 'webview')
    const html = await readFile(join(outputRoot, 'index.html'), 'utf8')
    expect(html).not.toContain('@kun/extension-api')
    const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
      .map((match) => match[1])
    expect(scriptSources.length).toBeGreaterThan(0)
    expect(scriptSources.every((source) => source.startsWith('./'))).toBe(true)
    for (const source of scriptSources) {
      const cleanSource = source.split(/[?#]/u, 1)[0]
      await readFile(resolve(outputRoot, cleanSource))
    }

    const javascriptFiles = await collectJavaScript(outputRoot)
    expect(javascriptFiles.length).toBeGreaterThan(0)
    for (const path of javascriptFiles) {
      const source = await readFile(path, 'utf8')
      expect(source).not.toContain('@kun/extension-api')
      expect(moduleSpecifiers(source).filter((specifier) => !specifier.startsWith('.'))).toEqual([])
    }
  })
})

async function collectJavaScript(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await collectJavaScript(path))
    else if (entry.isFile() && ['.js', '.mjs'].includes(extname(entry.name))) result.push(path)
  }
  return result
}

function moduleSpecifiers(source: string): string[] {
  const result: string[] = []
  const patterns = [
    /(?:^|[;\n])\s*(?:import|export)\s*(?:[^'"`;]*?\bfrom\s*)?["']([^"']+)["']/gmu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) result.push(match[1])
  }
  return result
}
