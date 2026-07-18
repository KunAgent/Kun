import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  resolveRepositoryKunCli,
  resolveRepositoryRoot,
  runRepositoryKunCli
} from './run-repository-kun-cli.mjs'

const examplesRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(examplesRoot, '..', '..')

test('repository CLI resolution is anchored to the helper location', () => {
  assert.equal(resolveRepositoryRoot(), repositoryRoot)
  assert.equal(
    resolveRepositoryKunCli(),
    join(repositoryRoot, 'kun', 'dist', 'cli', 'serve-entry.js')
  )
})

test('runner keeps the caller working directory and avoids a command shell', () => {
  const calls = []
  const status = runRepositoryKunCli({
    args: ['extension', 'validate', '.', '--json'],
    cliPath: '/repository/kun/dist/cli/serve-entry.js',
    cwd: '/repository/examples/extensions/example',
    exists: () => true,
    spawn(command, args, options) {
      calls.push({ command, args, options })
      return { status: 0 }
    }
  })

  assert.equal(status, 0)
  assert.deepEqual(calls, [{
    command: process.execPath,
    args: [
      '/repository/kun/dist/cli/serve-entry.js',
      'extension',
      'validate',
      '.',
      '--json'
    ],
    options: {
      cwd: '/repository/examples/extensions/example',
      env: process.env,
      shell: false,
      stdio: 'inherit'
    }
  }])
})

test('missing repository build fails with standalone-safe guidance', () => {
  assert.throws(
    () => runRepositoryKunCli({
      args: ['extension', 'validate', '.'],
      cliPath: '/missing/serve-entry.js',
      exists: () => false
    }),
    (error) => {
      assert.match(error.message, /npm run build:kun/u)
      assert.match(error.message, /published @kun packages by name/u)
      assert.match(error.message, /unrelated npm package named `kun`/u)
      return true
    }
  )
})

test('every repository example resolves validate and pack through the helper', async () => {
  const names = [
    'agent-assistant',
    'direct-dom',
    'hello-sidebar',
    'kun-video-editor',
    'presentation-studio',
    'streaming-model-provider',
    'tool-provider',
    'workspace-dashboard'
  ]

  for (const name of names) {
    const packageJson = JSON.parse(await readFile(join(examplesRoot, name, 'package.json'), 'utf8'))
    for (const scriptName of ['validate', 'pack']) {
      const script = packageJson.scripts?.[scriptName]
      assert.equal(typeof script, 'string', `${name} is missing ${scriptName}`)
      assert.match(
        script,
        /node \.\.\/run-repository-kun-cli\.mjs extension (?:validate|pack)/u,
        `${name} ${scriptName} does not use the repository CLI resolver`
      )
      assert.doesNotMatch(script, /\.\.\/\.\.\/\.\.\/kun/u)
    }
  }
})
