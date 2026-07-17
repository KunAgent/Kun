const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildValidationReport, isValidValidationReport } = require('../src/gep/validationReport');

describe('buildValidationReport', function () {
  it('builds a valid report with minimal input', function () {
    const report = buildValidationReport({
      geneId: 'gene_test',
      commands: ['echo hello'],
      results: [{ ok: true, stdout: 'hello', stderr: '' }],
    });
    assert.equal(report.type, 'ValidationReport');
    assert.equal(report.gene_id, 'gene_test');
    assert.equal(report.overall_ok, true);
    assert.equal(report.commands.length, 1);
    assert.equal(report.commands[0].command, 'echo hello');
    assert.equal(report.commands[0].ok, true);
    assert.ok(report.id.startsWith('vr_'));
    assert.ok(report.created_at);
    assert.ok(report.asset_id);
    assert.ok(report.env_fingerprint);
    assert.ok(report.env_fingerprint_key);
  });

  it('marks overall_ok false when any result fails', function () {
    const report = buildValidationReport({
      geneId: 'gene_fail',
      commands: ['cmd1', 'cmd2'],
      results: [
        { ok: true, stdout: 'ok' },
        { ok: false, stderr: 'error' },
      ],
    });
    assert.equal(report.overall_ok, false);
  });

  it('marks overall_ok false when results is empty', function () {
    const report = buildValidationReport({
      geneId: 'gene_empty',
      commands: [],
      results: [],
    });
    assert.equal(report.overall_ok, false);
  });

  it('handles null geneId', function () {
    const report = buildValidationReport({
      commands: ['test'],
      results: [{ ok: true }],
    });
    assert.equal(report.gene_id, null);
  });

  it('computes duration_ms from timestamps', function () {
    const report = buildValidationReport({
      geneId: 'gene_dur',
      commands: ['test'],
      results: [{ ok: true }],
      startedAt: 1000,
      finishedAt: 2500,
    });
    assert.equal(report.duration_ms, 1500);
  });

  it('duration_ms is null when timestamps missing', function () {
    const report = buildValidationReport({
      geneId: 'gene_nodur',
      commands: ['test'],
      results: [{ ok: true }],
    });
    assert.equal(report.duration_ms, null);
  });

  it('truncates stdout/stderr to 4000 chars', function () {
    const longOutput = 'x'.repeat(5000);
    const report = buildValidationReport({
      geneId: 'gene_long',
      commands: ['test'],
      results: [{ ok: true, stdout: longOutput, stderr: longOutput }],
    });
    assert.equal(report.commands[0].stdout.length, 4000);
    assert.equal(report.commands[0].stderr.length, 4000);
  });

  it('supports both out/stdout and err/stderr field names', function () {
    const report = buildValidationReport({
      geneId: 'gene_compat',
      commands: ['test'],
      results: [{ ok: true, out: 'output_via_out', err: 'error_via_err' }],
    });
    assert.equal(report.commands[0].stdout, 'output_via_out');
    assert.equal(report.commands[0].stderr, 'error_via_err');
  });

  it('infers commands from results when commands not provided', function () {
    const report = buildValidationReport({
      geneId: 'gene_infer',
      results: [{ ok: true, cmd: 'inferred_cmd' }],
    });
    assert.equal(report.commands[0].command, 'inferred_cmd');
  });

  it('uses provided envFp instead of capturing', function () {
    const customFp = { device_id: 'custom', platform: 'test' };
    const report = buildValidationReport({
      geneId: 'gene_fp',
      commands: ['test'],
      results: [{ ok: true }],
      envFp: customFp,
    });
    assert.equal(report.env_fingerprint.device_id, 'custom');
  });
});

describe('isValidValidationReport', function () {
  it('returns true for a valid report', function () {
    const report = buildValidationReport({
      geneId: 'gene_valid',
      commands: ['test'],
      results: [{ ok: true }],
    });
    assert.equal(isValidValidationReport(report), true);
  });

  it('returns false for null', function () {
    assert.equal(isValidValidationReport(null), false);
  });

  it('returns false for non-object', function () {
    assert.equal(isValidValidationReport('string'), false);
  });

  it('returns false for wrong type field', function () {
    assert.equal(isValidValidationReport({ type: 'Other', id: 'x', commands: [], overall_ok: true }), false);
  });

  it('returns false for missing id', function () {
    assert.equal(isValidValidationReport({ type: 'ValidationReport', commands: [], overall_ok: true }), false);
  });

  it('returns false for missing commands', function () {
    assert.equal(isValidValidationReport({ type: 'ValidationReport', id: 'x', overall_ok: true }), false);
  });

  it('returns false for missing overall_ok', function () {
    assert.equal(isValidValidationReport({ type: 'ValidationReport', id: 'x', commands: [] }), false);
  });
});
