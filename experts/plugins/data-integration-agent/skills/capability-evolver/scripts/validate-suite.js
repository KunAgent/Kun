// Usage: node scripts/validate-suite.js [test-glob-pattern]
// Runs the project's test suite (node --test) and fails if any test fails.
// When called without arguments, runs all tests in test/.
// When called with a glob pattern, runs only matching tests.
//
// This script is intended to be used as a Gene validation command.
// It provides stronger assurance than validate-modules.js (which only
// checks that modules can be loaded).

const { execSync } = require('child_process');
const path = require('path');

const pattern = process.argv[2] || 'test/**/*.test.js';
const repoRoot = process.cwd();

const cmd = `node --test ${pattern}`;

try {
  const output = execSync(cmd, {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
    env: (() => {
      const e = Object.assign({}, process.env, {
        NODE_ENV: 'test',
        EVOLVER_REPO_ROOT: repoRoot,
        GEP_ASSETS_DIR: path.join(repoRoot, 'assets', 'gep'),
      });
      delete e.EVOLVE_BRIDGE;
      delete e.OPENCLAW_WORKSPACE;
      return e;
    })(),
  });
  const out = output.toString('utf8');
  const passMatch = out.match(/# pass (\d+)/);
  const failMatch = out.match(/# fail (\d+)/);
  const passCount = passMatch ? Number(passMatch[1]) : 0;
  const failCount = failMatch ? Number(failMatch[1]) : 0;

  if (failCount > 0) {
    console.error('FAIL: ' + failCount + ' test(s) failed');
    process.exit(1);
  }
  if (passCount === 0) {
    console.error('FAIL: no tests found matching pattern: ' + pattern);
    process.exit(1);
  }
  console.log('ok: ' + passCount + ' test(s) passed, 0 failed');
} catch (e) {
  const stderr = e.stderr ? e.stderr.toString('utf8').slice(-500) : '';
  const stdout = e.stdout ? e.stdout.toString('utf8').slice(-500) : '';
  console.error('FAIL: test suite exited with code ' + (e.status || 'unknown'));
  if (stderr) console.error(stderr);
  if (stdout) console.error(stdout);
  process.exit(1);
}
