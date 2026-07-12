'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const {
  LINUX_SANDBOX_LAUNCHER_FLAG,
  _internals: {
    installLinuxElectronLauncher,
    linuxElectronLauncherContent,
    linuxRealExecutableName
  }
} = require('./after-pack.cjs')

function fixture(t, executableName = 'kun-gui') {
  const appOutDir = mkdtempSync(join(tmpdir(), 'kun-linux-launcher-test-'))
  t.after(() => rmSync(appOutDir, { recursive: true, force: true }))
  const executable = join(appOutDir, executableName)
  writeFileSync(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]))
  chmodSync(executable, 0o700)
  return {
    appOutDir,
    executable,
    context: {
      appOutDir,
      electronPlatformName: 'linux',
      packager: { executableName }
    }
  }
}

function runLauncher(executable, args, runAsNode = '') {
  return JSON.parse(execFileSync(executable, args, {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: runAsNode }
  }))
}

function executableLauncherFixture(t) {
  const appOutDir = mkdtempSync(join(tmpdir(), 'kun-linux-launcher-exec-test-'))
  t.after(() => rmSync(appOutDir, { recursive: true, force: true }))
  const executableName = 'kun-gui'
  const executable = join(appOutDir, executableName)
  const realExecutable = join(appOutDir, linuxRealExecutableName(executableName))
  writeFileSync(
    realExecutable,
    '#!/usr/bin/env node\n' +
      'process.stdout.write(JSON.stringify({ args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE }))\n'
  )
  chmodSync(realExecutable, 0o755)
  writeFileSync(executable, linuxElectronLauncherContent(executableName))
  chmodSync(executable, 0o755)
  return { appOutDir, executable, realExecutable }
}

test('installs an executable Linux product launcher over a preserved ELF payload', (t) => {
  const paths = fixture(t)
  installLinuxElectronLauncher(paths.context)

  const realExecutable = join(
    paths.appOutDir,
    linuxRealExecutableName(paths.context.packager.executableName)
  )
  assert.equal(existsSync(realExecutable), true)
  assert.equal(
    readFileSync(paths.executable, 'utf8'),
    linuxElectronLauncherContent(paths.context.packager.executableName)
  )
  assert.equal(statSync(paths.executable).mode & 0o777, 0o755)
  assert.equal(statSync(realExecutable).mode & 0o777, 0o755)
  assert.deepEqual([...readFileSync(realExecutable).subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46])
})

test('GUI prepends the sandbox flag without parsing or swallowing user arguments', (t) => {
  const paths = executableLauncherFixture(t)
  assert.deepEqual(runLauncher(paths.executable, ['--user-argument']).args, [
    LINUX_SANDBOX_LAUNCHER_FLAG,
    '--user-argument'
  ])
  assert.deepEqual(
    runLauncher(paths.executable, [LINUX_SANDBOX_LAUNCHER_FLAG, '--user-argument']).args,
    [LINUX_SANDBOX_LAUNCHER_FLAG, LINUX_SANDBOX_LAUNCHER_FLAG, '--user-argument']
  )
  assert.deepEqual(runLauncher(paths.executable, ['--', LINUX_SANDBOX_LAUNCHER_FLAG]).args, [
    LINUX_SANDBOX_LAUNCHER_FLAG,
    '--',
    LINUX_SANDBOX_LAUNCHER_FLAG
  ])
})

test('does not add a Chromium flag to ELECTRON_RUN_AS_NODE commands', (t) => {
  const paths = executableLauncherFixture(t)
  const result = runLauncher(paths.executable, ['runtime-entry.js', 'extension', 'list'], '1')
  assert.deepEqual(result.args, ['runtime-entry.js', 'extension', 'list'])
  assert.equal(result.runAsNode, '1')
})

test('fails closed for unsafe names, non-executables, and payload collisions', (t) => {
  const unsafe = fixture(t)
  unsafe.context.packager.executableName = '../escape'
  assert.throws(() => installLinuxElectronLauncher(unsafe.context), /Unsafe Linux executable name/)

  const nonExecutable = fixture(t)
  chmodSync(nonExecutable.executable, 0o644)
  assert.throws(
    () => installLinuxElectronLauncher(nonExecutable.context),
    /must be a non-symlink executable file/
  )

  const nonElf = fixture(t)
  writeFileSync(nonElf.executable, '#!/bin/sh\n')
  chmodSync(nonElf.executable, 0o755)
  assert.throws(() => installLinuxElectronLauncher(nonElf.context), /not an ELF payload/)

  if (process.platform !== 'win32') {
    const symlink = fixture(t)
    const outside = join(symlink.appOutDir, 'outside-elf')
    writeFileSync(outside, Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    chmodSync(outside, 0o755)
    rmSync(symlink.executable)
    symlinkSync(outside, symlink.executable)
    assert.throws(() => installLinuxElectronLauncher(symlink.context), /non-symlink executable/)
  }

  const collision = fixture(t)
  writeFileSync(
    join(collision.appOutDir, linuxRealExecutableName(collision.context.packager.executableName)),
    'collision'
  )
  assert.throws(() => installLinuxElectronLauncher(collision.context), /Refusing to overwrite/)

  const fuses = fixture(t)
  fuses.context.packager.config = { electronFuses: { runAsNode: false } }
  assert.throws(() => installLinuxElectronLauncher(fuses.context), /electronFuses cannot be applied/)
})

test('does not alter non-Linux packages', (t) => {
  const paths = fixture(t)
  paths.context.electronPlatformName = 'darwin'
  installLinuxElectronLauncher(paths.context)
  assert.equal(existsSync(paths.executable), true)
  assert.equal(
    existsSync(join(paths.appOutDir, linuxRealExecutableName(paths.context.packager.executableName))),
    false
  )
})
