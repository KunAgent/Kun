#!/usr/bin/env node
import process from 'node:process'
import { nodeVersionStartupError } from './node-version.js'

// ESM resolves static imports before executing this file. Keep Runtime imports
// behind the version check so unsupported Node versions receive this diagnostic.
const versionError = nodeVersionStartupError(process.versions.node, process.execPath)
if (versionError) {
  process.stderr.write(`${versionError}\n`)
  process.exitCode = 1
} else {
  await import('./serve-main.js')
}
