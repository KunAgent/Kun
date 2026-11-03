'use strict'

const assert = require('node:assert/strict')
const { dirname, join } = require('node:path')
const test = require('node:test')

const entry = require.resolve('@tufjs/models')
const { DelegatedRole } = require(join(dirname(entry), 'role.js'))
const minimatch = require(require.resolve('minimatch/package.json', { paths: [dirname(entry)] }))

test('TUF uses the patched minimatch version for delegation', () => {
  assert.equal(minimatch.version, '11.0.3')
  const role = new DelegatedRole({
    keyIDs: ['key-id'],
    threshold: 1,
    name: 'stable',
    terminating: true,
    paths: ['releases/*.json', 'targets/{linux,mac}/*.zip']
  })
  for (const path of ['releases/stable.json', 'targets/linux/app.zip', 'targets/mac/app.zip']) {
    assert.equal(role.isDelegatedPath(path), true, path)
  }
  for (const path of ['releases/.hidden.json', 'releases/nested/stable.json', 'targets/win/app.zip', 'targets/linux/app.exe']) {
    assert.equal(role.isDelegatedPath(path), false, path)
  }
})
