/**
 * Attribute extensions that carry Markdown source style on rich nodes
 * (implementation §3.4): list tightness/markers, table cell alignment, and
 * reference-style link/image fields. They only matter once a block is
 * edited — unchanged blocks emit their original source verbatim anyway.
 */
import { BulletList } from '@tiptap/extension-list'
import { TableCell, TableHeader } from '@tiptap/extension-table'
import { Link } from '@tiptap/extension-link'
import { mergeAttributes } from '@tiptap/core'

export const WriteBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: { default: true, rendered: false },
      marker: { default: '-', rendered: false }
    }
  }
})

const alignAttr = {
  align: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('align'),
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.align ? { align: String(attrs.align) } : {}
  }
}

export const WriteTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttr }
  }
})

export const WriteTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttr }
  }
})

/**
 * Link mark with reference-style fields. `identifier` set means the source
 * was `[text][id]` / `[text][]` / `[text]`; serialize back to that form
 * until the user edits it into an inline link.
 */
export const WriteLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      identifier: { default: null, rendered: false },
      label: { default: null, rendered: false },
      reference: { default: null, rendered: false }
    }
  }
})

/** Image attrs for `[![][id]]`-style reference images. */
export const writeImageReferenceAttributes = {
  identifier: { default: null, rendered: false },
  label: { default: null, rendered: false },
  reference: { default: null, rendered: false }
}
