const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isConstraintCountedPath,
  parseNumstatRows,
  isForbiddenPath,
  classifyBlastSeverity,
  analyzeBlastRadiusBreakdown,
  compareBlastEstimate,
  isValidationCommandAllowed,
  buildFailureReason,
  classifyFailureMode,
  BLAST_RADIUS_HARD_CAP_FILES,
  BLAST_RADIUS_HARD_CAP_LINES,
} = require('../src/gep/policyCheck');
const { computeProcessScores } = require('../src/gep/solidify');
const { normalizeRelPath, isCriticalProtectedPath } = require('../src/gep/gitOps');

describe('normalizeRelPath', () => {
  it('strips backslashes and leading ./', () => {
    assert.equal(normalizeRelPath('.\\src\\evolve.js'), 'src/evolve.js');
    assert.equal(normalizeRelPath('./src/evolve.js'), 'src/evolve.js');
  });

  it('returns empty for falsy input', () => {
    assert.equal(normalizeRelPath(null), '');
    assert.equal(normalizeRelPath(undefined), '');
    assert.equal(normalizeRelPath(''), '');
  });
});

describe('isCriticalProtectedPath', () => {
  it('protects skill directories', () => {
    assert.equal(isCriticalProtectedPath('skills/evolver/index.js'), true);
    assert.equal(isCriticalProtectedPath('skills/feishu-evolver-wrapper/lifecycle.js'), true);
  });

  it('protects root files', () => {
    assert.equal(isCriticalProtectedPath('MEMORY.md'), true);
    assert.equal(isCriticalProtectedPath('.env'), true);
    assert.equal(isCriticalProtectedPath('package.json'), true);
  });

  it('allows non-critical paths', () => {
    assert.equal(isCriticalProtectedPath('src/evolve.js'), false);
    assert.equal(isCriticalProtectedPath('skills/my-new-skill/index.js'), false);
    assert.equal(isCriticalProtectedPath('test/foo.test.js'), false);
  });
});

describe('isConstraintCountedPath', () => {
  const defaultPolicy = {
    excludePrefixes: ['logs/', 'memory/', 'assets/gep/', 'node_modules/'],
    excludeExact: ['event.json', 'temp_gep_output.json'],
    excludeRegex: ['capsule', 'events?\\.jsonl$'],
    includePrefixes: ['src/', 'scripts/'],
    includeExact: ['index.js', 'package.json'],
    includeExtensions: ['.js', '.json', '.ts'],
  };

  it('counts src/ files', () => {
    assert.equal(isConstraintCountedPath('src/evolve.js', defaultPolicy), true);
    assert.equal(isConstraintCountedPath('src/gep/solidify.js', defaultPolicy), true);
  });

  it('excludes memory/ and logs/', () => {
    assert.equal(isConstraintCountedPath('memory/graph.jsonl', defaultPolicy), false);
    assert.equal(isConstraintCountedPath('logs/evolver.log', defaultPolicy), false);
  });

  it('excludes exact matches', () => {
    assert.equal(isConstraintCountedPath('event.json', defaultPolicy), false);
  });

  it('excludes regex matches', () => {
    assert.equal(isConstraintCountedPath('assets/gep/capsules.json', defaultPolicy), false);
  });

  it('includes exact root files', () => {
    assert.equal(isConstraintCountedPath('index.js', defaultPolicy), true);
    assert.equal(isConstraintCountedPath('package.json', defaultPolicy), true);
  });

  it('includes by extension', () => {
    assert.equal(isConstraintCountedPath('config/settings.json', defaultPolicy), true);
  });

  it('returns false for empty path', () => {
    assert.equal(isConstraintCountedPath('', defaultPolicy), false);
  });
});

describe('parseNumstatRows', () => {
  it('parses standard numstat output', () => {
    const input = '10\t5\tsrc/evolve.js\n3\t1\tsrc/gep/solidify.js\n';
    const rows = parseNumstatRows(input);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].file, 'src/evolve.js');
    assert.equal(rows[0].added, 10);
    assert.equal(rows[0].deleted, 5);
    assert.equal(rows[1].file, 'src/gep/solidify.js');
  });

  it('handles rename arrows', () => {
    const input = '5\t3\tsrc/{old.js => new.js}\n';
    const rows = parseNumstatRows(input);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].file, 'new.js');
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(parseNumstatRows(''), []);
    assert.deepEqual(parseNumstatRows(null), []);
  });
});

describe('isForbiddenPath', () => {
  it('blocks exact match', () => {
    assert.equal(isForbiddenPath('.git', ['.git', 'node_modules']), true);
  });

  it('blocks prefix match', () => {
    assert.equal(isForbiddenPath('node_modules/dotenv/index.js', ['.git', 'node_modules']), true);
  });

  it('allows non-forbidden paths', () => {
    assert.equal(isForbiddenPath('src/evolve.js', ['.git', 'node_modules']), false);
  });

  it('handles empty forbidden list', () => {
    assert.equal(isForbiddenPath('src/evolve.js', []), false);
  });
});

describe('classifyBlastSeverity', () => {
  it('returns within_limit for small changes', () => {
    const r = classifyBlastSeverity({ blast: { files: 3, lines: 50 }, maxFiles: 20 });
    assert.equal(r.severity, 'within_limit');
  });

  it('returns approaching_limit above 80%', () => {
    const r = classifyBlastSeverity({ blast: { files: 17, lines: 100 }, maxFiles: 20 });
    assert.equal(r.severity, 'approaching_limit');
  });

  it('returns exceeded when over limit', () => {
    const r = classifyBlastSeverity({ blast: { files: 25, lines: 100 }, maxFiles: 20 });
    assert.equal(r.severity, 'exceeded');
  });

  it('returns critical_overrun at 2x limit', () => {
    const r = classifyBlastSeverity({ blast: { files: 45, lines: 100 }, maxFiles: 20 });
    assert.equal(r.severity, 'critical_overrun');
  });

  it('returns hard_cap_breach above system limit', () => {
    const r = classifyBlastSeverity({ blast: { files: BLAST_RADIUS_HARD_CAP_FILES + 1, lines: 0 }, maxFiles: 200 });
    assert.equal(r.severity, 'hard_cap_breach');
  });

  it('returns hard_cap_breach for lines over system limit', () => {
    const r = classifyBlastSeverity({ blast: { files: 1, lines: BLAST_RADIUS_HARD_CAP_LINES + 1 }, maxFiles: 200 });
    assert.equal(r.severity, 'hard_cap_breach');
  });
});

describe('analyzeBlastRadiusBreakdown', () => {
  it('groups files by top-level directory', () => {
    const files = ['src/gep/a.js', 'src/gep/b.js', 'src/ops/c.js', 'test/d.js'];
    const result = analyzeBlastRadiusBreakdown(files, 3);
    assert.ok(result.length <= 3);
    assert.ok(result[0].files >= 2);
  });

  it('returns empty for no files', () => {
    assert.deepEqual(analyzeBlastRadiusBreakdown([], 5), []);
  });
});

describe('compareBlastEstimate', () => {
  it('returns null when no estimate', () => {
    assert.equal(compareBlastEstimate(null, { files: 5 }), null);
  });

  it('detects drift when actual is 3x+ estimate', () => {
    const r = compareBlastEstimate({ files: 3 }, { files: 15 });
    assert.ok(r);
    assert.equal(r.drifted, true);
  });

  it('no drift when close to estimate', () => {
    const r = compareBlastEstimate({ files: 5 }, { files: 6 });
    assert.ok(r);
    assert.equal(r.drifted, false);
  });
});

describe('isValidationCommandAllowed', () => {
  it('allows node commands', () => {
    assert.equal(isValidationCommandAllowed('node scripts/validate.js'), true);
  });

  it('allows npm commands', () => {
    assert.equal(isValidationCommandAllowed('npm test'), true);
  });

  it('blocks shell operators', () => {
    assert.equal(isValidationCommandAllowed('node test.js && rm -rf /'), false);
    assert.equal(isValidationCommandAllowed('node test.js; echo hacked'), false);
  });

  it('blocks backtick injection', () => {
    assert.equal(isValidationCommandAllowed('node `whoami`'), false);
  });

  it('blocks node -e (eval)', () => {
    assert.equal(isValidationCommandAllowed('node -e "process.exit(1)"'), false);
  });

  it('blocks node --eval', () => {
    assert.equal(isValidationCommandAllowed('node --eval "console.log(1)"'), false);
  });

  it('blocks node -p (print)', () => {
    assert.equal(isValidationCommandAllowed('node -p "1+1"'), false);
  });

  it('blocks node --print', () => {
    assert.equal(isValidationCommandAllowed('node --print "require(\'fs\')"'), false);
  });

  it('blocks $() command substitution', () => {
    assert.equal(isValidationCommandAllowed('node $(echo malicious).js'), false);
  });

  it('allows npx commands', () => {
    assert.equal(isValidationCommandAllowed('npx vitest run'), true);
  });

  it('allows node scripts with arguments', () => {
    assert.equal(isValidationCommandAllowed('node scripts/validate-modules.js ./src/evolve ./src/gep/solidify'), true);
  });

  it('allows node scripts/validate-suite.js', () => {
    assert.equal(isValidationCommandAllowed('node scripts/validate-suite.js'), true);
  });

  it('blocks non-allowed commands', () => {
    assert.equal(isValidationCommandAllowed('rm -rf /'), false);
    assert.equal(isValidationCommandAllowed('curl http://evil.com'), false);
  });

  it('returns false for empty', () => {
    assert.equal(isValidationCommandAllowed(''), false);
    assert.equal(isValidationCommandAllowed(null), false);
  });
});

describe('buildFailureReason', () => {
  it('combines constraint, protocol, and validation failures', () => {
    const result = buildFailureReason(
      { violations: ['max_files exceeded'] },
      { results: [{ ok: false, cmd: 'node test.js', err: 'exit 1' }] },
      ['missing Mutation object'],
      null
    );
    assert.ok(result.includes('constraint: max_files exceeded'));
    assert.ok(result.includes('protocol: missing Mutation object'));
    assert.ok(result.includes('validation_failed'));
  });

  it('returns unknown for empty inputs', () => {
    assert.equal(buildFailureReason({}, {}, [], null), 'unknown');
  });
});

describe('classifyFailureMode', () => {
  it('returns hard for destructive constraint violations', () => {
    const r = classifyFailureMode({ constraintViolations: ['CRITICAL_FILE_DELETED: MEMORY.md'] });
    assert.equal(r.mode, 'hard');
    assert.equal(r.retryable, false);
  });

  it('returns hard for protocol violations', () => {
    const r = classifyFailureMode({ protocolViolations: ['missing Mutation'] });
    assert.equal(r.mode, 'hard');
  });

  it('returns soft for validation failures', () => {
    const r = classifyFailureMode({ validation: { ok: false } });
    assert.equal(r.mode, 'soft');
    assert.equal(r.retryable, true);
  });

  it('returns soft unknown for no failures', () => {
    const r = classifyFailureMode({});
    assert.equal(r.mode, 'soft');
    assert.equal(r.reasonClass, 'unknown');
  });
});

describe('computeProcessScores', () => {
  it('gives validation_pass_rate of 0.5 when validation results are empty', () => {
    const scores = computeProcessScores({
      constraintCheck: { ok: true, violations: [] },
      validation: { ok: true, results: [] },
      protocolViolations: [],
      canary: { ok: true, skipped: true },
      blast: { files: 1, lines: 10 },
      geneUsed: { type: 'Gene', id: 'gene_test', constraints: { max_files: 20 } },
      signals: ['error'],
      mutation: { rationale: 'test fix', category: 'repair', risk_level: 'low' },
    });
    assert.equal(scores.validation_pass_rate, 0.5);
  });

  it('gives validation_pass_rate of 1.0 when all validations pass', () => {
    const scores = computeProcessScores({
      constraintCheck: { ok: true, violations: [] },
      validation: { ok: true, results: [{ ok: true, cmd: 'node test.js' }] },
      protocolViolations: [],
      canary: { ok: true, skipped: true },
      blast: { files: 1, lines: 10 },
      geneUsed: { type: 'Gene', id: 'gene_test', constraints: { max_files: 20 } },
      signals: ['error'],
      mutation: { rationale: 'test fix', category: 'repair', risk_level: 'low' },
    });
    assert.equal(scores.validation_pass_rate, 1.0);
  });

  it('gives validation_pass_rate of 0 when validation failed and has no results', () => {
    const scores = computeProcessScores({
      constraintCheck: { ok: true, violations: [] },
      validation: { ok: false, results: [] },
      protocolViolations: [],
      canary: { ok: true, skipped: true },
      blast: { files: 1, lines: 10 },
      geneUsed: { type: 'Gene', id: 'gene_test', constraints: { max_files: 20 } },
      signals: ['error'],
      mutation: null,
    });
    assert.equal(scores.validation_pass_rate, 0);
  });

  it('computes partial validation score when some results fail', () => {
    const scores = computeProcessScores({
      constraintCheck: { ok: true, violations: [] },
      validation: { ok: false, results: [
        { ok: true, cmd: 'node a.js' },
        { ok: false, cmd: 'node b.js' },
      ] },
      protocolViolations: [],
      canary: { ok: true, skipped: true },
      blast: { files: 1, lines: 10 },
      geneUsed: { type: 'Gene', id: 'gene_test', constraints: { max_files: 20 } },
      signals: ['error'],
      mutation: { rationale: 'fix', category: 'repair' },
    });
    assert.equal(scores.validation_pass_rate, 0.5);
  });
});
