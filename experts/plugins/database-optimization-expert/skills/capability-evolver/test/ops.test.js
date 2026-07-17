const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// --- health_check tests ---

describe('health_check - runHealthCheck', () => {
  it('returns status, timestamp, and checks array', () => {
    const { runHealthCheck } = require('../src/ops/health_check');
    const result = runHealthCheck();

    assert.strictEqual(typeof result.status, 'string');
    assert.ok(['ok', 'warning', 'error'].includes(result.status));
    assert.strictEqual(typeof result.timestamp, 'string');
    assert.ok(Array.isArray(result.checks));
    assert.ok(result.checks.length > 0);
  });

  it('includes disk_space check', () => {
    const { runHealthCheck } = require('../src/ops/health_check');
    const result = runHealthCheck();
    const diskCheck = result.checks.find(c => c.name === 'disk_space');
    assert.ok(diskCheck, 'should include a disk_space check');
    assert.strictEqual(typeof diskCheck.ok, 'boolean');
  });

  it('includes memory check', () => {
    const { runHealthCheck } = require('../src/ops/health_check');
    const result = runHealthCheck();
    const memCheck = result.checks.find(c => c.name === 'memory');
    assert.ok(memCheck, 'should include a memory check');
    assert.strictEqual(typeof memCheck.ok, 'boolean');
  });
});

// --- cleanup tests ---

describe('cleanup - run', () => {
  let tmpDir;
  let origEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
    origEnv = {
      EVOLUTION_DIR: process.env.EVOLUTION_DIR,
      EVOLVER_SESSION_SCOPE: process.env.EVOLVER_SESSION_SCOPE,
      OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE,
    };
    process.env.EVOLUTION_DIR = tmpDir;
    delete process.env.EVOLVER_SESSION_SCOPE;
    delete process.env.OPENCLAW_WORKSPACE;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('returns 0 when directory is empty', () => {
    const { run } = require('../src/ops/cleanup');
    const deleted = run();
    assert.strictEqual(deleted, 0);
  });

  it('keeps at least MIN_KEEP recent files', () => {
    const { run } = require('../src/ops/cleanup');
    for (let i = 0; i < 15; i++) {
      const name = `gep_prompt_${String(i).padStart(3, '0')}.json`;
      fs.writeFileSync(path.join(tmpDir, name), '{}');
      // Set old mtime for files beyond MIN_KEEP
      if (i < 5) {
        const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
        fs.utimesSync(path.join(tmpDir, name), oldTime, oldTime);
      }
    }

    run();

    const remaining = fs.readdirSync(tmpDir).filter(f => f.startsWith('gep_prompt_'));
    assert.ok(remaining.length >= 10, `should keep at least 10 files, got ${remaining.length}`);
  });

  it('deletes old files beyond MIN_KEEP', () => {
    const { run } = require('../src/ops/cleanup');
    for (let i = 0; i < 20; i++) {
      const name = `gep_prompt_${String(i).padStart(3, '0')}.json`;
      fs.writeFileSync(path.join(tmpDir, name), '{}');
      const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
      fs.utimesSync(path.join(tmpDir, name), oldTime, oldTime);
    }

    const deleted = run();
    assert.ok(deleted > 0, 'should delete some old files');
  });

  it('ignores non-gep files', () => {
    const { run } = require('../src/ops/cleanup');
    fs.writeFileSync(path.join(tmpDir, 'important_config.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');

    run();

    assert.ok(fs.existsSync(path.join(tmpDir, 'important_config.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'readme.txt')));
  });
});

// --- config module tests ---

describe('config - centralized thresholds', () => {
  it('exports all expected network constants', () => {
    const cfg = require('../src/config');
    assert.strictEqual(typeof cfg.HELLO_TIMEOUT_MS, 'number');
    assert.strictEqual(typeof cfg.HEARTBEAT_TIMEOUT_MS, 'number');
    assert.strictEqual(typeof cfg.HTTP_TRANSPORT_TIMEOUT_MS, 'number');
    assert.ok(cfg.HELLO_TIMEOUT_MS > 0);
  });

  it('exports all expected solidify constants', () => {
    const cfg = require('../src/config');
    assert.strictEqual(typeof cfg.VALIDATION_TIMEOUT_MS, 'number');
    assert.strictEqual(typeof cfg.CANARY_TIMEOUT_MS, 'number');
    assert.strictEqual(typeof cfg.CAPSULE_CONTENT_MAX_CHARS, 'number');
    assert.strictEqual(typeof cfg.SOLIDIFY_MAX_RETRIES, 'number');
    assert.strictEqual(typeof cfg.MIN_PUBLISH_SCORE, 'number');
  });

  it('exports all expected ops constants', () => {
    const cfg = require('../src/config');
    assert.strictEqual(typeof cfg.MAX_SILENCE_MS, 'number');
    assert.strictEqual(typeof cfg.CLEANUP_MAX_AGE_MS, 'number');
    assert.strictEqual(typeof cfg.CLEANUP_MIN_KEEP, 'number');
    assert.strictEqual(typeof cfg.LOCK_MAX_AGE_MS, 'number');
  });

  it('respects environment variable overrides via envInt', () => {
    const { envInt } = require('../src/config');
    const orig = process.env.EVOLVER_TEST_INT;
    process.env.EVOLVER_TEST_INT = '42';
    try {
      assert.strictEqual(envInt('EVOLVER_TEST_INT', 10), 42);
    } finally {
      if (orig !== undefined) process.env.EVOLVER_TEST_INT = orig;
      else delete process.env.EVOLVER_TEST_INT;
    }
  });

  it('falls back to default when env var is empty', () => {
    const { envInt } = require('../src/config');
    const orig = process.env.EVOLVER_TEST_EMPTY;
    process.env.EVOLVER_TEST_EMPTY = '';
    try {
      assert.strictEqual(envInt('EVOLVER_TEST_EMPTY', 99), 99);
    } finally {
      if (orig !== undefined) process.env.EVOLVER_TEST_EMPTY = orig;
      else delete process.env.EVOLVER_TEST_EMPTY;
    }
  });

  it('falls back to default when env var is non-numeric', () => {
    const { envInt } = require('../src/config');
    const orig = process.env.EVOLVER_TEST_NAN;
    process.env.EVOLVER_TEST_NAN = 'abc';
    try {
      assert.strictEqual(envInt('EVOLVER_TEST_NAN', 77), 77);
    } finally {
      if (orig !== undefined) process.env.EVOLVER_TEST_NAN = orig;
      else delete process.env.EVOLVER_TEST_NAN;
    }
  });
});
