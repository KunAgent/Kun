/**
 * Fixed task corpus for the P3-16 manager evaluation (docs/ade/impl/
 * p3-review-followup.md). Each task is a self-contained repo fixture:
 * `files` are planted over a fresh git baseline, `prompt` is sent verbatim
 * to both modes (single Kun thread vs ADE manager), and `verify.run` is the
 * objective success check executed in the final workspace.
 *
 * Tasks are intentionally small (single- to few-file edits) so one run is a
 * handful of model calls, but they cover the doc's spread: bug fixes, test
 * authoring, cross-file refactors, features, docs, and two parallel work
 * streams where delegation has a natural advantage.
 */
export const EVAL_TASKS = [
  {
    id: 't01-sum-off-by-one',
    kind: 'bugfix',
    prompt: 'lib/sum.js should return the sum of an array but returns NaN because the loop reads past the end. Fix it so `node check.mjs` exits 0.',
    files: {
      'lib/sum.js': "export function sum(xs) {\n  let t = 0\n  for (let i = 0; i <= xs.length; i++) t += xs[i]\n  return t\n}\n",
      'check.mjs': "import { sum } from './lib/sum.js'\nif (sum([1, 2, 3]) !== 6 || sum([]) !== 0) { console.error('sum wrong'); process.exit(1) }\nconsole.log('ok')\n"
    },
    verify: { run: 'node check.mjs' }
  },
  {
    id: 't02-parse-trim',
    kind: 'bugfix',
    prompt: 'lib/parse.js must parse a user-supplied number string but returns NaN when the input has surrounding whitespace. Fix it so `node check.mjs` exits 0.',
    files: {
      'lib/parse.js': "export function parseCount(text) {\n  return Number(text)\n}\n",
      'check.mjs': "import { parseCount } from './lib/parse.js'\nif (parseCount('  42  ') !== 42 || parseCount('7') !== 7) { console.error('parse wrong'); process.exit(1) }\nconsole.log('ok')\n"
    },
    verify: { run: 'node check.mjs' }
  },
  {
    id: 't03-divide-tests',
    kind: 'test',
    prompt: 'Write node:test tests for lib/divide.js in test/divide.test.mjs covering normal division and the divide-by-zero throw, so `node --test` exits 0.',
    files: {
      'lib/divide.js': "export function divide(a, b) {\n  if (b === 0) throw new Error('division by zero')\n  return a / b\n}\n"
    },
    verify: { run: 'node --test' }
  },
  {
    id: 't04-split-helpers',
    kind: 'refactor',
    prompt: 'lib/helpers.js mixes string and number helpers. Split it into lib/str.js (string helpers) and lib/num.js (number helpers), update main.mjs imports, keep helpers.js gone, so `node main.mjs` prints `ok 4`.',
    files: {
      'lib/helpers.js': "export function shout(s) { return s.toUpperCase() }\nexport function whisper(s) { return s.toLowerCase() }\nexport function add(a, b) { return a + b }\nexport function twice(n) { return n * 2 }\n",
      'main.mjs': "import { shout, whisper, add, twice } from './lib/helpers.js'\nconst out = [shout('a'), whisper('B'), add(1, 2), twice(2)]\nconsole.log(out.length === 4 && out[0] === 'A' && out[1] === 'b' && out[2] === 3 && out[3] === 4 ? 'ok 4' : 'bad')\n"
    },
    verify: { run: 'node main.mjs | grep -q "ok 4"' }
  },
  {
    id: 't05-cli-upper-flag',
    kind: 'feature',
    prompt: 'cli.mjs echoes its first argument. Add an `--upper` flag that prints the argument uppercased, so `node cli.mjs --upper hello` prints `HELLO` and `node cli.mjs hello` still prints `hello`.',
    files: {
      'cli.mjs': "const arg = process.argv[2] ?? ''\nconsole.log(arg)\n"
    },
    verify: { run: 'test "$(node cli.mjs --upper hello)" = "HELLO" && test "$(node cli.mjs hello)" = "hello"' }
  },
  {
    id: 't06-reverse-export',
    kind: 'feature',
    prompt: 'Add an exported `reverse(s)` function to lib/str.js and use it in main.mjs so `node main.mjs` prints `cba`.',
    files: {
      'lib/str.js': "export function upcase(s) { return s.toUpperCase() }\n",
      'main.mjs': "import { upcase } from './lib/str.js'\nconsole.log(upcase('abc'))\n"
    },
    verify: { run: 'test "$(node main.mjs)" = "cba"' }
  },
  {
    id: 't07-two-bugs',
    kind: 'parallel',
    prompt: 'Two independent modules are broken: a.js drops its last element and b.js returns undefined for even input. Fix both so `node check-a.mjs` and `node check-b.mjs` each exit 0. The files are independent — work on them as two separate tasks if helpful.',
    files: {
      'a.js': "export function tail1(xs) { return xs.slice(0, xs.length - 1) }\n",
      'check-a.mjs': "import { tail1 } from './a.js'\nif (tail1([1, 2, 3]).join(',') !== '1,2,3') { console.error('a wrong'); process.exit(1) }\nconsole.log('ok a')\n",
      'b.js': "export function isEven(n) { if (n % 2 === 0) { return } return false }\n",
      'check-b.mjs': "import { isEven } from './b.js'\nif (isEven(4) !== true || isEven(3) !== false) { console.error('b wrong'); process.exit(1) }\nconsole.log('ok b')\n"
    },
    verify: { run: 'node check-a.mjs && node check-b.mjs' }
  },
  {
    id: 't08-two-scripts',
    kind: 'parallel',
    prompt: 'Create two independent scripts: scripts/gen-a.mjs that prints exactly `A` and scripts/gen-b.mjs that prints exactly `B`. They share no code — treat them as two independent pieces of work if helpful.',
    files: {},
    verify: { run: 'test "$(node scripts/gen-a.mjs)" = "A" && test "$(node scripts/gen-b.mjs)" = "B"' }
  },
  {
    id: 't09-rename-calc',
    kind: 'refactor',
    prompt: 'Rename the exported function `calcTotal` to `computeTotal` in lib/total.js and update both call sites (one.mjs, two.mjs) so `node one.mjs` prints `10` and `node two.mjs` prints `20`.',
    files: {
      'lib/total.js': "export function calcTotal(xs) { return xs.reduce((a, b) => a + b, 0) }\n",
      'one.mjs': "import { calcTotal } from './lib/total.js'\nconsole.log(calcTotal([4, 6]))\n",
      'two.mjs': "import { calcTotal } from './lib/total.js'\nconsole.log(calcTotal([10, 10]))\n"
    },
    verify: { run: 'test "$(node one.mjs)" = "10" && test "$(node two.mjs)" = "20" && ! grep -rq "calcTotal" .' }
  },
  {
    id: 't10-readme-usage',
    kind: 'docs',
    prompt: 'main.mjs is the entry point. Append a `## Usage` section to README.md documenting how to run it with `node main.mjs <name>` and what it prints.',
    files: {
      'main.mjs': "const name = process.argv[2] ?? 'world'\nconsole.log(`hello ${name}`)\n",
      'README.md': '# greeter\n'
    },
    verify: { run: 'grep -q "## Usage" README.md && grep -q "node main.mjs" README.md' }
  }
]
