/**
 * Codec benchmarks (implementation §11): document open (parse+convert),
 * single-keystroke serialization, and external-sync reparse at 30k / 100k /
 * 300k characters. Run with `npx vitest bench`.
 *
 * Targets: 100k open ≤150ms, 300k open ≤500ms, single-block serialize ≤5ms.
 */
import { bench, describe } from 'vitest'
import { parseWorkDocument, serializeWorkDocument } from './document-codec'

function makeDoc(chars: number): string {
  const unit = [
    '## Section\n\n',
    'A paragraph with *emphasis*, `code`, [a link](https://example.com) and $x^2$ math.\n\n',
    '- item one\n- item two with **bold**\n- item three\n\n',
    '> [!note] Title\n> callout body\n\n',
    '| a | b |\n|---|---|\n| 1 | 2 |\n\n'
  ].join('')
  let out = '---\ntitle: bench\n---\n\n'
  while (out.length < chars) out += unit
  return out
}

for (const size of [30_000, 100_000, 300_000]) {
  describe(`document-codec ${size} chars`, () => {
    const markdown = makeDoc(size)

    bench('open (parse + mdast→pm)', () => {
      parseWorkDocument(markdown)
    })

    const { doc, ctx } = parseWorkDocument(markdown)

    bench('serialize unchanged (all-verbatim)', () => {
      serializeWorkDocument(doc, ctx)
    })

    // Simulate a one-block edit: change text of block 1.
    const edited = JSON.parse(JSON.stringify(doc))
    const block = edited.content?.[1]
    if (block?.content?.[0]) block.content[0].text = 'edited text'

    bench('serialize after one-block edit', () => {
      serializeWorkDocument(edited, ctx)
    })

    bench('external sync reparse', () => {
      parseWorkDocument(markdown + '\n')
    })
  })
}
