'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { verifyCandidateSource } = require('./release-candidate-source.cjs')

const commit = 'a'.repeat(40)
function fixture({ target = commit, tagName = 'v0.3.8', isDraft = true } = {}) {
  const calls = []
  return { calls, run: async (command, args) => {
    calls.push({ command, args })
    return { stdout: command === 'git'
      ? `${'c'.repeat(40)}\trefs/tags/v0.3.8\n${target}\trefs/tags/v0.3.8^{}\n`
      : JSON.stringify({ tagName, isDraft }) }
  } }
}

test('revalidation binds the existing candidate to its tag independently of the harness checkout', async () => {
  const stub = fixture()
  assert.equal(await verifyCandidateSource('0.3.8', 'v0.3.8', commit, stub.run), commit)
  assert.deepEqual(stub.calls[0], { command: 'git', args: ['ls-remote', '--exit-code',
    'https://github.com/KunAgent/Kun.git', 'refs/tags/v0.3.8', 'refs/tags/v0.3.8^{}'] })
  assert.equal(stub.calls[1].command, 'gh')
})

test('revalidation rejects another commit or an already published release', async () => {
  await assert.rejects(verifyCandidateSource('0.3.8', 'v0.3.8', commit,
    fixture({ target: 'b'.repeat(40) }).run), /another commit/)
  await assert.rejects(verifyCandidateSource('0.3.8', 'v0.3.8', commit,
    fixture({ isDraft: false }).run), /unpublished candidate/)
  await assert.rejects(verifyCandidateSource('0.3.8', 'v0.3.8', commit,
    fixture({ tagName: 'v0.3.9' }).run))
})

test('invalid candidate inputs fail before executing external commands', async () => {
  const stub = fixture()
  for (const values of [['bad', 'vbad', commit], ['0.3.8', 'v0.3.9', commit], ['0.3.8', 'v0.3.8', 'develop']]) {
    await assert.rejects(verifyCandidateSource(...values, stub.run))
  }
  assert.equal(stub.calls.length, 0)
})
