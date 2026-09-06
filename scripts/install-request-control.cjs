'use strict'

function createInstallRequestControl(journal) {
  let failure
  return {
    recordResult(result) {
      if (!failure) journal.record.installResult = result
      if (result?.ok === false && !failure) {
        failure = Object.assign(new Error(result.message || result.error || 'Update installation was rejected'), {
          code: result.code || 'install_failed', phase: 'install_requested'
        })
        Object.assign(journal.record, { status: 'failed', phase: failure.phase,
          code: failure.code, error: failure.message })
      }
      journal.event('install_result', { result })
    },
    check() {
      // A successful handoff may close IPC before replying. Only an explicit
      // rejection is terminal; absence of an acknowledgement is not failure.
      if (failure) throw failure
    }
  }
}

module.exports = { createInstallRequestControl }
