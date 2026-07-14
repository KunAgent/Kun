'use strict'

const NATIVE_SMOKE_RULES = Object.freeze([
  { id: 'main', test: (path) => path.startsWith('src/main/'), reason: 'main-process code can change packaged runtime behavior' },
  { id: 'preload', test: (path) => path.startsWith('src/preload/'), reason: 'preload bridge changes require packaged IPC validation' },
  { id: 'builder', test: (path) => /^electron-builder(?:\.|\/)/.test(path), reason: 'electron-builder configuration changes package layout' },
  { id: 'scripts', test: (path) => path.startsWith('scripts/'), reason: 'packaging or smoke scripts changed' },
  { id: 'icons', test: (path) => path.startsWith('assets/icons/'), reason: 'packaged icon assets changed' },
  { id: 'kun-runtime', test: (path) => path.startsWith('kun/src/'), reason: 'Kun runtime changes require packaged backend validation' },
  { id: 'native-dependencies', test: (path) => path === 'package.json' || path === 'package-lock.json' || path.startsWith('packages/'), reason: 'native or extension dependencies may change packaged behavior' }
])

function normalizePath(path) {
  if (typeof path !== 'string') return ''
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '')
}

function evaluateNativeSmoke(paths, options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {}
  const normalizedPaths = [...new Set((Array.isArray(paths) ? paths : []).map(normalizePath).filter(Boolean))]
  const manual = safeOptions.event === 'workflow_dispatch' || safeOptions.force === true
  const matches = []
  for (const path of normalizedPaths) {
    for (const rule of NATIVE_SMOKE_RULES) {
      if (rule.test(path)) matches.push({ path, ruleId: rule.id, reason: rule.reason })
    }
  }
  const uniqueMatches = matches.filter((match, index, all) =>
    all.findIndex((candidate) => candidate.path === match.path && candidate.ruleId === match.ruleId) === index
  )
  if (manual) {
    return {
      decision: 'native-smoke-required',
      required: true,
      reason: safeOptions.event === 'workflow_dispatch' ? 'manual workflow dispatch requested native smoke' : 'native smoke explicitly forced',
      changedPaths: normalizedPaths,
      matches: uniqueMatches
    }
  }
  if (uniqueMatches.length > 0) {
    return {
      decision: 'native-smoke-required',
      required: true,
      reason: 'one or more changed paths affect packaged behavior',
      changedPaths: normalizedPaths,
      matches: uniqueMatches
    }
  }
  return {
    decision: 'native-smoke-skipped-with-reason',
    required: false,
    reason: normalizedPaths.length === 0
      ? 'no changed paths were supplied'
      : 'changed paths do not affect native packaging or packaged runtime behavior',
    changedPaths: normalizedPaths,
    matches: []
  }
}

module.exports = {
  NATIVE_SMOKE_RULES,
  evaluateNativeSmoke,
  normalizePath
}
