import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, posix, win32 } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  API_EXPORTS_BEGIN,
  API_EXPORTS_END,
  SDK_SNAPSHOTS_BEGIN,
  SDK_SNAPSHOTS_END,
  githubHeadingSlug,
  isPathWithinRoot,
  renderApiExportsRegion,
  renderSdkSnapshotsRegion,
  validateBilingualPair,
  validateGeneratedRegion,
  validateMarkdownLinks,
  validateMarkdownSnippets
} from './lib/extension-docs-validation.mjs'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'extension-docs')

test('accepts structurally paired bilingual Markdown and compilable snippets', async () => {
  const chinese = await fixture('valid.md')
  const english = await fixture('valid.en.md')
  assert.deepEqual(validateBilingualPair('valid.md', chinese, 'valid.en.md', english), [])
  assert.deepEqual(validateMarkdownSnippets('valid.md', chinese), { problems: [], checked: 2 })
})

test('rejects bilingual heading hierarchy drift', async () => {
  const problems = validateBilingualPair(
    'valid.md',
    await fixture('valid.md'),
    'invalid-heading.en.md',
    await fixture('invalid-heading.en.md')
  )
  assert.ok(problems.some((problem) => problem.includes('heading hierarchy differs')))
})

test('validates usable Markdown anchors instead of only target-file existence', async () => {
  const path = join(fixtures, 'valid.md')
  const markdown = await fixture('valid.md')
  assert.deepEqual(await validateMarkdownLinks('valid.md', path, markdown, new Map([[path, markdown]])), [])
  const broken = markdown.replace('](#部分)', '](#missing)')
  const problems = await validateMarkdownLinks('broken.md', path, broken, new Map([[path, broken]]))
  assert.ok(problems.some((problem) => problem.includes('broken Markdown anchor')))
})

test('normalizes inline HTML in heading anchors without executable-text sanitization', () => {
  assert.equal(githubHeadingSlug('<span>Extension</span> API'), 'extension-api')
  assert.equal(githubHeadingSlug('Nested <span title="<b>">heading</span>'), 'nested-heading')
  assert.equal(githubHeadingSlug('Unclosed <span heading'), 'unclosed-span-heading')
  assert.equal(githubHeadingSlug('<script>alert(1)</script> Safe'), 'alert1-safe')
})

test('rejects invalid JSON and TypeScript snippets while allowing reasoned skips', async () => {
  const invalidJson = validateMarkdownSnippets('invalid-json.md', await fixture('invalid-json.md'))
  assert.ok(invalidJson.problems.some((problem) => problem.includes('invalid JSON snippet')))
  const invalidTypescript = validateMarkdownSnippets(
    'invalid-typescript.md',
    await fixture('invalid-typescript.md')
  )
  assert.ok(invalidTypescript.problems.some((problem) => problem.includes('invalid TypeScript snippet')))
  assert.deepEqual(
    validateMarkdownSnippets('skipped-typescript.md', await fixture('skipped-typescript.md')),
    { problems: [], checked: 0 }
  )
})

test('detects generated API inventory and Changelog public-surface drift', () => {
  const packages = [{
    name: '@kun/example',
    version: '1.0.0',
    entryPoints: ['.'],
    surfaceSha256: 'abc123',
    exports: [
      { name: 'ExampleClient', kind: 'class', module: 'client' },
      { name: 'ExampleOptions', kind: 'interface', module: 'client' }
    ]
  }]
  const expectedApi = renderApiExportsRegion(packages, 'en')
  assert.deepEqual(validateGeneratedRegion(
    'api-reference.en.md',
    expectedApi,
    expectedApi,
    API_EXPORTS_BEGIN,
    API_EXPORTS_END
  ), [])
  assert.ok(validateGeneratedRegion(
    'api-reference.en.md',
    expectedApi.replace('ExampleClient', 'StaleClient'),
    expectedApi,
    API_EXPORTS_BEGIN,
    API_EXPORTS_END
  )[0].includes('drifted'))

  const expectedSnapshots = renderSdkSnapshotsRegion(packages)
  assert.deepEqual(validateGeneratedRegion(
    'changelog.en.md',
    expectedSnapshots,
    expectedSnapshots,
    SDK_SNAPSHOTS_BEGIN,
    SDK_SNAPSHOTS_END
  ), [])
  assert.ok(validateGeneratedRegion(
    'changelog.en.md',
    expectedSnapshots.replace('abc123', 'stale'),
    expectedSnapshots,
    SDK_SNAPSHOTS_BEGIN,
    SDK_SNAPSHOTS_END
  )[0].includes('drifted'))
})

test('contains public SDK declarations across native and mixed Windows separators', () => {
  assert.equal(
    isPathWithinRoot(
      'D:\\a\\Kun\\Kun\\packages\\extension-api\\src',
      'D:/a/Kun/Kun/packages/extension-api/src/accounts.ts',
      win32
    ),
    true
  )
  assert.equal(
    isPathWithinRoot(
      'D:\\a\\Kun\\Kun\\packages\\extension-api\\src',
      'D:/a/Kun/Kun/packages/extension-api/src-escape/accounts.ts',
      win32
    ),
    false
  )
  assert.equal(isPathWithinRoot('/repo/packages/api/src', '/repo/packages/api/src/index.ts', posix), true)
  assert.equal(isPathWithinRoot('/repo/packages/api/src', '/repo/packages/other/index.ts', posix), false)
})

function fixture(name) {
  return readFile(join(fixtures, name), 'utf8')
}
