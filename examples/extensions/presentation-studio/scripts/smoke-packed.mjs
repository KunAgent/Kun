import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { extractKunxArchive } from '../../../../kun/dist/extensions/archive.js'

const execFileAsync = promisify(execFile)
const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = dirname(dirname(dirname(extensionRoot)))
const temporary = await mkdtemp(join(tmpdir(), 'presentation-studio-pack-smoke-'))

try {
  const archivePath = join(temporary, 'presentation-studio.kunx')
  const { stdout } = await execFileAsync(process.execPath, [
    join(repositoryRoot, 'kun', 'dist', 'cli', 'serve-entry.js'),
    'extension', 'pack', extensionRoot,
    '--output', archivePath,
    '--overwrite',
    '--json'
  ])
  const output = JSON.parse(stdout.trim().split('\n').at(-1))
  assert.equal(output.schemaVersion, 1)
  assert.equal(output.result.archivePath, archivePath)

  const extractedRoot = join(temporary, 'extracted')
  const extracted = await extractKunxArchive(archivePath, extractedRoot)
  assert.equal(extracted.manifest.main, 'dist/host/extension.js')
  assert.equal(extracted.manifest.version, '0.1.10')
  assert.deepEqual(extracted.manifest.contributes['views.rightSidebar'], [{
    id: 'studio',
    title: 'Kun PPT',
    entry: 'dist/webview/index.html',
    icon: 'assets/presentation-studio.svg',
    showInRightRail: true,
    order: 40,
    multiple: false,
    localResourceRoots: ['dist/webview']
  }])
  assert.deepEqual(extracted.manifest.contributes['views.fullPage'], [])
  assert.deepEqual(extracted.manifest.contributes.agentProfiles, [])
  assert.ok(!extracted.manifest.permissions.includes('agent.run'))
  const webviewHtml = await readFile(join(extractedRoot, 'dist', 'webview', 'index.html'), 'utf8')
  assert.match(webviewHtml, /id="image-file-picker"/u)
  assert.match(webviewHtml, /type="file"/u)
  assert.doesNotMatch(webviewHtml, /id="image-dialog"/u)
  assert.doesNotMatch(webviewHtml, /inline-text-editor/u)
  const webviewAssetsRoot = join(extractedRoot, 'dist', 'webview', 'assets')
  const webviewAssets = await readdir(webviewAssetsRoot)
  const webviewScript = await readFile(
    join(webviewAssetsRoot, webviewAssets.find((name) => name.endsWith('.js'))),
    'utf8'
  )
  const webviewStyles = await readFile(
    join(webviewAssetsRoot, webviewAssets.find((name) => name.endsWith('.css'))),
    'utf8'
  )
  assert.match(webviewScript, /canvas-text-content/u)
  assert.match(webviewScript, /plaintext-only/u)
  assert.match(webviewStyles, /\.canvas-text-content/u)
  assert.doesNotMatch(webviewStyles, /inline-text-editor/u)
  assert.match(
    await readFile(join(extractedRoot, 'assets', 'presentation-studio.svg'), 'utf8'),
    /<svg\b/u
  )
  const extensionModule = await import(
    `${pathToFileURL(join(extractedRoot, extracted.manifest.main)).href}?smoke=${Date.now()}`
  )
  assert.equal(typeof extensionModule.activate, 'function')

  const commandIds = []
  const toolIds = []
  const disposables = []
  const disposable = () => ({ dispose: () => undefined })
  const context = {
    subscriptions: { add(value) { disposables.push(value); return value } },
    workspace: {},
    commands: {
      async registerCommand(id) {
        commandIds.push(id)
        return disposable()
      }
    },
    tools: {
      async registerTool(declaration) {
        toolIds.push(declaration.id)
        return disposable()
      }
    }
  }
  await extensionModule.activate(context)
  assert.deepEqual(commandIds.sort(), [
    'presentation-create',
    'presentation-export-copy',
    'presentation-load',
    'presentation-save'
  ])
  assert.deepEqual(toolIds.sort(), [
    'presentation-apply',
    'presentation-create',
    'presentation-export-copy',
    'presentation-read',
    'presentation-validate'
  ])
  for (const registration of disposables) await registration.dispose()
  await extensionModule.deactivate?.()
  process.stdout.write('Packed Kun PPT extracted, imported, and activated successfully.\n')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
