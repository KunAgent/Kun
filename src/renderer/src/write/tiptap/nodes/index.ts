/**
 * Work construct nodes + attribute extensions composing the rich schema
 * additions (implementation §3.2, §7). `WriteBlockId` must come first so the
 * global attribute applies to every listed node type.
 */
import type { AnyExtension } from '@tiptap/core'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { mathEditorFor, WriteMathInput } from '../math-edit'
import { WriteBlockId } from './write-block-id'
import { RawMarkdownBlock } from './raw-markdown-block'
import { Callout } from './callout'
import { FootnoteReference, InlineHtml, WikiLink } from './inline-constructs'
import {
  WriteBulletList,
  WriteLink,
  WriteTableCell,
  WriteTableHeader
} from './work-style-attrs'

export {
  WriteBlockId,
  RawMarkdownBlock,
  Callout,
  WikiLink,
  FootnoteReference,
  InlineHtml,
  WriteBulletList,
  WriteLink,
  WriteTableCell,
  WriteTableHeader
}

export function buildWorkConstructExtensions(): AnyExtension[] {
  return [
    WriteBlockId,
    WriteBulletList,
    WriteLink.configure({ openOnClick: false }),
    WriteTableHeader,
    WriteTableCell,
    Callout,
    RawMarkdownBlock,
    WikiLink,
    FootnoteReference,
    InlineHtml,
    BlockMath.configure({
      katexOptions: { throwOnError: false },
      onClick: (node, pos) => mathEditorFor(node, pos, 'block')
    }),
    InlineMath.configure({
      katexOptions: { throwOnError: false },
      onClick: (node, pos) => mathEditorFor(node, pos, 'inline')
    }),
    WriteMathInput
  ]
}
