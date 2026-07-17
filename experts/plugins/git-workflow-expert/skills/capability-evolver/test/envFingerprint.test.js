const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { captureEnvFingerprint, envFingerprintKey, isSameEnvClass } = require('../src/gep/envFingerprint');

describe('captureEnvFingerprint', function () {
  it('returns an object with expected fields', function () {
    const fp = captureEnvFingerprint();
    assert.equal(typeof fp, 'object');
    assert.equal(typeof fp.device_id, 'string');
    assert.equal(typeof fp.node_version, 'string');
    assert.equal(typeof fp.platform, 'string');
    assert.equal(typeof fp.arch, 'string');
    assert.equal(typeof fp.os_release, 'string');
    assert.equal(typeof fp.hostname, 'string');
    assert.equal(typeof fp.container, 'boolean');
    assert.equal(typeof fp.cwd, 'string');
  });

  it('hashes hostname to 12 chars', function () {
    const fp = captureEnvFingerprint();
    assert.equal(fp.hostname.length, 12);
  });

  it('hashes cwd to 12 chars', function () {
    const fp = captureEnvFingerprint();
    assert.equal(fp.cwd.length, 12);
  });

  it('node_version starts with v', function () {
    const fp = captureEnvFingerprint();
    assert.ok(fp.node_version.startsWith('v'));
  });

  it('returns consistent results across calls', function () {
    const fp1 = captureEnvFingerprint();
    const fp2 = captureEnvFingerprint();
    assert.equal(fp1.device_id, fp2.device_id);
    assert.equal(fp1.platform, fp2.platform);
    assert.equal(fp1.hostname, fp2.hostname);
  });
});

describe('envFingerprintKey', function () {
  it('returns a 16-char hex string', function () {
    const fp = captureEnvFingerprint();
    const key = envFingerprintKey(fp);
    assert.equal(typeof key, 'string');
    assert.equal(key.length, 16);
    assert.match(key, /^[0-9a-f]{16}$/);
  });

  it('returns unknown for null input', function () {
    assert.equal(envFingerprintKey(null), 'unknown');
  });

  it('returns unknown for non-object input', function () {
    assert.equal(envFingerprintKey('string'), 'unknown');
  });

  it('same fingerprint produces same key', function () {
    const fp = captureEnvFingerprint();
    assert.equal(envFingerprintKey(fp), envFingerprintKey(fp));
  });

  it('different fingerprints produce different keys', function () {
    const fp1 = captureEnvFingerprint();
    const fp2 = { ...fp1, device_id: 'different_device' };
    assert.notEqual(envFingerprintKey(fp1), envFingerprintKey(fp2));
  });
});

describe('isSameEnvClass', function () {
  it('returns true for identical fingerprints', function () {
    const fp = captureEnvFingerprint();
    assert.equal(isSameEnvClass(fp, fp), true);
  });

  it('returns true for fingerprints with same key fields', function () {
    const fp1 = captureEnvFingerprint();
    const fp2 = { ...fp1, cwd: 'different_cwd' };
    assert.equal(isSameEnvClass(fp1, fp2), true);
  });

  it('returns false for different environments', function () {
    const fp1 = captureEnvFingerprint();
    const fp2 = { ...fp1, device_id: 'other_device' };
    assert.equal(isSameEnvClass(fp1, fp2), false);
  });
});
