import assert from 'node:assert/strict'

/** Check installed bootstrap requirements, not a transitive package retired upstream. */
export function assertNativeBootstrapLock(lock, semver) {
  const packages = lock.packages ?? {}
  const runtimeName = '@napi-rs/wasm-runtime'
  const runtime = packages[`node_modules/${runtimeName}`]
  const referenced = Object.values(packages).some((entry) =>
    ['dependencies', 'optionalDependencies', 'peerDependencies'].some((kind) => entry[kind]?.[runtimeName]))
  assert.ok(!referenced || runtime, 'Kun lock references @napi-rs/wasm-runtime but its package node is missing')
  for (const dependency of ['@emnapi/core', '@emnapi/runtime']) {
    const node = packages[`node_modules/${dependency}`]
    const range = packages['']?.dependencies?.[dependency]
    assert.ok(semver.valid(node?.version), `Kun lock must contain top-level ${dependency} with a valid SemVer`)
    assert.ok(typeof range === 'string' && semver.satisfies(node.version, range),
      `Kun lock ${dependency}@${node.version} must satisfy its production dependency ${String(range)}`)
    assert.notEqual(node.dev, true, `Kun bootstrap ${dependency} must remain a production dependency`)
    if (runtime) {
      const peerRange = runtime.peerDependencies?.[dependency]
      assert.ok(typeof peerRange === 'string' && semver.satisfies(node.version, peerRange),
        `Kun lock ${dependency}@${node.version} must satisfy @napi-rs/wasm-runtime peer ${String(peerRange)}`)
    }
  }
}
