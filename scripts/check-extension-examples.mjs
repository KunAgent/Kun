import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const examplesRoot = join(root, 'examples', 'extensions')
const examples = (await readdir(examplesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const expected = [
  'agent-assistant',
  'direct-dom',
  'hello-sidebar',
  'kun-video-editor',
  'presentation-studio',
  'social-media-sidebar',
  'streaming-model-provider',
  'tool-provider',
  'workspace-dashboard'
]
if (JSON.stringify(examples) !== JSON.stringify(expected)) {
  throw new Error(`Extension examples changed without updating validation: ${examples.join(', ')}`)
}

run('npm', ['run', 'build:extensions'])
run('npm', ['run', 'build:kun'])
run('node', ['--test', join(examplesRoot, 'run-repository-kun-cli.test.mjs')])

for (const packageName of ['@kun/extension-api', '@kun/extension-react', '@kun/extension-test']) {
  await import(packageName)
}
await import(pathToFileURL(join(root, 'packages', 'create-kun-extension', 'src', 'scaffold.mjs')).href)

const temporary = await mkdtemp(join(tmpdir(), 'kun-extension-examples-'))
try {
  for (const name of examples) {
    const directory = join(examplesRoot, name)
    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(join(directory, 'kun-extension.json'), 'utf8'))
    run('npm', ['--prefix', directory, 'run', 'typecheck'])
    run('npm', ['--prefix', directory, 'run', 'build'])
    if (manifest.main !== undefined) {
      await assertNodeBuild(directory, manifest.main)
    }
    if (manifest.browser !== undefined) {
      await assertBrowserBuild(directory, manifest.browser)
    }
    run('node', [join(examplesRoot, 'validate-manifest.mjs'), join(directory, 'kun-extension.json')])
    if (packageJson.scripts?.test) run('npm', ['--prefix', directory, 'run', 'test'])
    run('npm', ['--prefix', directory, 'run', 'validate', '--', '--json'])
    run('npm', [
      '--prefix', directory, 'run', 'pack', '--',
      '--output', join(temporary, `${name}.kunx`), '--overwrite', '--json'
    ])
  }
} finally {
  await Promise.all(examples.map((name) =>
    rm(join(examplesRoot, name, 'dist'), { recursive: true, force: true })
  ))
  await rm(temporary, { recursive: true, force: true })
}

process.stdout.write(
  `Extension examples OK: ${examples.length} typechecked, built, browser-artifact checked, validated, packed, and smoke-tested.\n`
)

async function assertBrowserBuild(directory, browserEntry) {
  const outputRoot = resolve(directory, dirname(browserEntry))
  const htmlPath = resolve(directory, browserEntry)
  assertInside(outputRoot, htmlPath, 'browser entry')
  const html = await readFile(htmlPath, 'utf8')
  if (html.includes('@kun/extension-api')) {
    throw new Error(`${relative(root, htmlPath)} contains a bare @kun/extension-api reference`)
  }

  const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
  if (scriptSources.length === 0) {
    throw new Error(`${relative(root, htmlPath)} has no external browser script`)
  }
  for (const source of scriptSources) {
    const cleanSource = source.split(/[?#]/u, 1)[0]
    if (!cleanSource.startsWith('./')) {
      throw new Error(`${relative(root, htmlPath)} contains a non-relative script URL: ${source}`)
    }
    const scriptPath = resolve(dirname(htmlPath), cleanSource)
    assertInside(outputRoot, scriptPath, 'browser script')
    await readFile(scriptPath)
  }

  const javascriptFiles = await collectJavaScript(outputRoot)
  if (javascriptFiles.length === 0) {
    throw new Error(`${relative(root, outputRoot)} has no JavaScript build artifact`)
  }
  for (const path of javascriptFiles) {
    const source = await readFile(path, 'utf8')
    if (source.includes('@kun/extension-api')) {
      throw new Error(`${relative(root, path)} contains a bare @kun/extension-api reference`)
    }
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith('.')) {
        throw new Error(`${relative(root, path)} contains an unresolved module specifier: ${specifier}`)
      }
    }
  }
}

async function assertNodeBuild(directory, mainEntry) {
  const entryPath = resolve(directory, mainEntry)
  assertInside(resolve(directory), entryPath, 'Node Host entry')
  const source = await readFile(entryPath, 'utf8')
  for (const specifier of moduleSpecifiers(source)) {
    if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
      throw new Error(
        `${relative(root, entryPath)} contains an unresolved Node Host module specifier: ${specifier}`
      )
    }
  }
}

async function collectJavaScript(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await collectJavaScript(path))
    else if (entry.isFile() && ['.js', '.mjs'].includes(extname(entry.name))) result.push(path)
  }
  return result
}

function moduleSpecifiers(source) {
  const result = []
  const patterns = [
    /\bimport\s+(?:[\w$*{},\s]+\s+from\s+)?["']([^"']+)["']/gu,
    /\bexport\s+(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]{0,4096}\})\s*from\s*["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) result.push(match[1])
  }
  return result
}

function assertInside(rootDirectory, path, label) {
  const fromRoot = relative(rootDirectory, path)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`${label} escapes its declared Webview output root: ${path}`)
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' }
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`)
  }
}
