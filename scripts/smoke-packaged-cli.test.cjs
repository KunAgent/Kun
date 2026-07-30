'use strict'

const assert = require('node:assert/strict')
const {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const {
  CLI_HELP_SENTINEL,
  packagedCliInvocation,
  parseArgs,
  runDebCliSmoke,
  runPackagedCliSmoke
} = require('./smoke-packaged-cli.cjs')

function packagedFixture(t, platform) {
  const root = mkdtempSync(join(tmpdir(), `kun-packaged-cli-${platform}-`))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const resources = platform === 'darwin'
    ? join(root, 'Kun.app', 'Contents', 'Resources')
    : join(root, 'resources')
  const cliEntry = join(
    resources,
    'app.asar.unpacked',
    'kun',
    'dist',
    'cli',
    'serve-entry.js'
  )
  mkdirSync(join(cliEntry, '..'), { recursive: true })
  writeFileSync(cliEntry, 'entry')

  if (platform === 'darwin') {
    const launcher = join(resources, 'bin', 'kun')
    mkdirSync(join(resources, 'bin'), { recursive: true })
    writeHelpExecutable(launcher)
  } else if (platform === 'linux') {
    writeHelpExecutable(join(root, 'kun-gui'))
  } else {
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(
      join(root, 'bin', 'kun.cmd'),
      `@echo off\r\necho ${CLI_HELP_SENTINEL.replace('<', '^<').replace('>', '^>')}\r\n`
    )
  }
  return { root, resources }
}

function writeHelpExecutable(path) {
  writeFileSync(
    path,
    `#!/usr/bin/env node\nprocess.stdout.write(process.argv.includes('--version') ? 'kun 1.2.3\\n' : ${JSON.stringify(`${CLI_HELP_SENTINEL}\n`)})\n`
  )
  chmodSync(path, 0o755)
}

test('executes packaged macOS and Linux CLI launchers and verifies their help banner', {
  skip: process.platform === 'win32' && 'requires POSIX executable modes and symlinks'
}, (t) => {
  const mac = packagedFixture(t, 'darwin')
  assert.match(
    runPackagedCliSmoke(mac.resources, {
      platform: 'darwin',
      expectedVersion: '1.2.3'
    }),
    /kun <command>/
  )

  const linux = packagedFixture(t, 'linux')
  assert.match(
    runPackagedCliSmoke(linux.resources, {
      platform: 'linux',
      expectedVersion: '1.2.3'
    }),
    /kun <command>/
  )
})

test('builds a shell-free Windows cmd invocation relative to packaged resources', (t) => {
  const windows = packagedFixture(t, 'win32')
  const invocation = packagedCliInvocation(windows.resources, { platform: 'win32' })
  assert.match(invocation.command, /cmd\.exe$/i)
  assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.match(invocation.args[3], /bin[\\/]kun\.cmd" --help"$/)
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.windowsVerbatimArguments, true)
})

test('executes the packaged Windows cmd launcher without quote re-escaping', {
  skip: process.platform !== 'win32' && 'requires cmd.exe'
}, (t) => {
  const windows = packagedFixture(t, 'win32')
  assert.match(
    runPackagedCliSmoke(windows.resources, { platform: 'win32' }),
    /kun <command>/
  )
})

test('extracts a deb and executes its packaged product launcher in CLI mode', {
  skip: process.platform === 'win32' && 'requires POSIX executable modes'
}, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'kun-packaged-cli-deb-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const deb = join(directory, 'Kun-1.2.3-linux-amd64.deb')
  writeFileSync(deb, 'deb')
  const calls = []

  const output = runDebCliSmoke(deb, {
    platform: 'linux',
    expectedVersion: '1.2.3',
    spawnSyncCommand(command, args, options) {
      calls.push({ command, args, options })
      if (command === 'dpkg-deb') {
        const extractedRoot = args[2]
        const resources = join(extractedRoot, 'opt', 'Kun', 'resources')
        const entry = join(
          resources,
          'app.asar.unpacked',
          'kun',
          'dist',
          'cli',
          'serve-entry.js'
        )
        mkdirSync(join(entry, '..'), { recursive: true })
        writeFileSync(entry, 'entry')
        writeHelpExecutable(join(extractedRoot, 'opt', 'Kun', 'kun-gui'))
        return { status: 0, stdout: '', stderr: '' }
      }
      return {
        status: 0,
        stdout: args.includes('--version') ? 'kun 1.2.3\n' : `${CLI_HELP_SENTINEL}\n`,
        stderr: ''
      }
    }
  })

  assert.match(output, /kun <command>/)
  assert.equal(calls[0].command, 'dpkg-deb')
  assert.equal(calls[1].options.env.KUN_CLI_ENTRY, '1')
  assert.equal(calls[1].options.shell, false)
  assert.deepEqual(calls[2].args, ['--version'])
})

test('requires explicit resources and rejects unknown arguments', () => {
  assert.deepEqual(
    parseArgs(['--resources', '/app/resources', '--deb', '/release/Kun.deb']),
    { resources: '/app/resources', deb: '/release/Kun.deb' }
  )
  assert.deepEqual(
    parseArgs(['--resources', '/app/resources', '--expected-version', '1.2.3']),
    { resources: '/app/resources', expectedVersion: '1.2.3' }
  )
  assert.throws(() => parseArgs([]), /--resources is required/)
  assert.throws(
    () => parseArgs(['--resources', '/app/resources', '--expected-version', 'daily']),
    /Invalid expected Kun version/
  )
  assert.throws(() => parseArgs(['--wat']), /Unknown argument/)
})
