#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { npmBuildSettings } from '../kun/scripts/npm-version.mjs'
import { locateNpm } from './lib/kun-npm-smoke-process.mjs'

const descriptor = JSON.parse(await readFile('kun/npm/release.json', 'utf8'))
const source = JSON.parse(await readFile('kun/package.json', 'utf8'))
const settings = npmBuildSettings(descriptor, source.version)
const args = process.argv.slice(2)
const windowsOnly = args[0] === '--windows-payload-only'
if (windowsOnly && args.length !== 1) throw Error('Windows payload-only mode does not accept pack arguments')
const run = (command, arguments_) => {
  const result = spawnSync(command, arguments_, { cwd: process.cwd(), env: settings.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('Building Kun npm candidate ' + settings.version + ' from Runtime source ' + settings.runtimeSourceVersion)
run(process.execPath, [locateNpm(process.execPath),
  ...(windowsOnly ? ['--prefix', 'kun', 'run', 'build:windows-startup'] : ['run', 'build:kun'])])
if (!windowsOnly) run(process.execPath, [resolve('kun/scripts/npm-pack.mjs'), ...args])
