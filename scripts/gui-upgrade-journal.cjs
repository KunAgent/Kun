'use strict'

const { appendFileSync, writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { mkdir, writeFile, readFile, rename } = require('node:fs/promises')
const assert = require('node:assert/strict')

async function claimScenarioDirectory(path, root) {
  await mkdir(path)
  await writeFile(join(path, '.upgrade-acceptance-owner'), root)
}

async function preserveScenarioDirectory(path, root, name) {
  assert.equal(await readFile(join(path, '.upgrade-acceptance-owner'), 'utf8'), root,
    'Refusing to move a directory not owned by this acceptance scenario')
  await rename(path, join(root, name))
}

function createScenarioJournal(record, root, persistReport = () => {}) {
  record.evidence = root
  record.cleanupErrors ??= []
  const eventPath = join(root, 'updater-events.jsonl')
  const persist = () => {
    writeFileSync(join(root, 'scenario.json'), JSON.stringify(record, null, 2))
    persistReport()
  }
  const event = (name, details = {}) => {
    appendFileSync(eventPath, JSON.stringify({ time: new Date().toISOString(), event: name,
      phase: record.phase, targetVersion: record.targetVersion, pid: record.baselinePid,
      executable: record.executable, ...details }) + '\n')
    persist()
  }
  return {
    record, eventPath, persist, event,
    phase(name, details = {}) {
      record.phase = name
      record.updatedAt = new Date().toISOString()
      event(name, details)
    },
    fail(error) {
      record.status = 'failed'
      if (typeof error.phase === 'string') record.phase = error.phase
      if (typeof error.code === 'string') record.code = error.code
      record.error = error.message || String(error)
      record.errorStack = error.stack
      event('scenario_failed', { error: record.error })
    },
    readEvents() {
      try { return readFileSync(eventPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse) }
      catch { return [] }
    }
  }
}

async function cleanupScenario(journal, steps) {
  for (const [name, action] of steps) {
    try { await action() } catch (error) {
      journal.record.cleanupErrors.push({ name, error: error.message || String(error) })
      journal.event('cleanup_failed', { name, error: error.message || String(error) })
    }
  }
}

async function recordScenario(report, name, action, persist) {
  const record = { name, status: 'running', phase: 'setup', cleanupErrors: [],
    startedAt: new Date().toISOString() }
  report.scenarios.push(record)
  persist()
  try {
    await action(record)
    if (record.cleanupErrors.length) {
      record.phase = 'cleanup'
      throw new Error(`${name}: scenario cleanup failed`)
    }
    record.status = 'passed'
  } catch (error) {
    record.status = 'failed'
    record.error ??= error.message || String(error)
    record.errorStack ??= error.stack
    report.status = 'failed'
    report.error = record.error
    throw error
  } finally {
    record.completedAt = new Date().toISOString()
    if (record.evidence) writeFileSync(join(record.evidence, 'scenario.json'), JSON.stringify(record, null, 2))
    persist()
  }
}

module.exports = { createScenarioJournal, cleanupScenario, recordScenario,
  claimScenarioDirectory, preserveScenarioDirectory }
