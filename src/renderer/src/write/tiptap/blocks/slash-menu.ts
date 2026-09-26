import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import i18n from '../../../i18n'
import { bodyZoom, toLayoutPx } from '../../../lib/body-zoom'

export type WriteSlashMenuOptions = {
  isReadOnly: () => boolean
  getWorkspaceRoot: () => string
  getFilePath: () => string
  getImageDirectory: () => string
}

type SlashItem = {
  id: string
  labelKey: string
  glyph: string
  keywords: string[]
}

const SLASH_ITEMS: SlashItem[] = [
  { id: 'paragraph', labelKey: 'writeBlockTypeParagraph', glyph: 'Aa', keywords: ['text', 'paragraph', 'zw', '正文', 'wb'] },
  { id: 'heading1', labelKey: 'writeBlockTypeHeading1', glyph: 'H1', keywords: ['h1', 'heading', 'bt', '标题'] },
  { id: 'heading2', labelKey: 'writeBlockTypeHeading2', glyph: 'H2', keywords: ['h2', 'heading', 'bt', '标题'] },
  { id: 'heading3', labelKey: 'writeBlockTypeHeading3', glyph: 'H3', keywords: ['h3', 'heading', 'bt', '标题'] },
  { id: 'bulletList', labelKey: 'writeBlockTypeBullet', glyph: '-', keywords: ['ul', 'bullet', 'list', 'lb', '列表', 'wx'] },
  { id: 'orderedList', labelKey: 'writeBlockTypeOrdered', glyph: '1.', keywords: ['ol', 'ordered', 'list', 'lb', '列表', 'yx'] },
  { id: 'taskList', labelKey: 'writeBlockTypeTaskList', glyph: '[ ]', keywords: ['todo', 'task', 'check', 'rw', '任务', 'db'] },
  { id: 'blockquote', labelKey: 'writeBlockTypeQuote', glyph: '>', keywords: ['quote', 'blockquote', 'yy', '引用'] },
  { id: 'codeBlock', labelKey: 'writeBlockTypeCode', glyph: '{}', keywords: ['code', 'pre', 'dm', '代码'] },
  { id: 'mermaid', labelKey: 'writeBlockTypeMermaid', glyph: 'Dia', keywords: ['mermaid', 'diagram', 'chart', 'tz', '图表'] },
  { id: 'blockMath', labelKey: 'writeBlockTypeMath', glyph: 'fx', keywords: ['math', 'katex', 'formula', 'gs', '公式'] },
  { id: 'table', labelKey: 'writeBlockTypeTable', glyph: '[+]', keywords: ['table', 'grid', 'bg', '表格'] },
  { id: 'callout', labelKey: 'writeBlockTypeCallout', glyph: '!', keywords: ['callout', 'note', 'admonition', 'ts', '提示'] },
  { id: 'horizontalRule', labelKey: 'writeBlockTypeDivider', glyph: '--', keywords: ['hr', 'divider', 'rule', 'fgx', '分割线'] },
  { id: 'image', labelKey: 'writeBlockTypeImage', glyph: 'Img', keywords: ['image', 'img', 'picture', 'tp', '图片'] },
  { id: 'link', labelKey: 'writeBlockTypeLink', glyph: 'Ln', keywords: ['link', 'url', 'href', 'lj', '链接'] }
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter((item) =>
    item.id.toLowerCase().includes(q) ||
    item.keywords.some((keyword) => keyword.toLowerCase().includes(q))
  )
}

function relativeImageMarkdownPath(filePath: string, workspaceRelativePath: string): string {
  const normalize = (value: string): string[] => value.replace(/\\/g, '/').split('/').filter(Boolean)
  const fileDir = normalize(filePath).slice(0, -1)
  const target = normalize(workspaceRelativePath)
  let shared = 0
  while (shared < fileDir.length && shared < target.length && fileDir[shared] === target[shared]) {
    shared += 1
  }
  const ups = fileDir.length - shared
  return [...Array.from({ length: ups }, () => '..'), ...target.slice(shared)].join('/')
}

export async function insertPickedImage(editor: import('@tiptap/core').Editor, options: WriteSlashMenuOptions): Promise<void> {
  const workspaceRoot = options.getWorkspaceRoot().trim()
  const filePath = options.getFilePath().trim()
  if (!workspaceRoot || !filePath || typeof window.kunGui?.pickWorkspaceImage !== 'function') return
  const imageDirectory = options.getImageDirectory().trim()
  const picked = await window.kunGui.pickWorkspaceImage({
    workspaceRoot,
    ...(imageDirectory ? { imageDirectory } : {})
  }).catch(() => null)
  if (!picked?.ok) return
  const relative = picked.workspaceRelativePath || picked.relativePath || ''
  if (!relative) return
  const src = relativeImageMarkdownPath(filePath, relative)
  editor.chain().focus().insertContent({ type: 'image', attrs: { src, alt: '' } }).run()
}

function runItem(
  editor: import('@tiptap/core').Editor,
  range: { from: number; to: number },
  query: string | undefined,
  item: SlashItem,
  options: WriteSlashMenuOptions
): void {
  const { state } = editor
  // Stale-check (implementation §9.5): the range must still cover exactly
  // `/<query>`; an out-of-date menu must never rewrite newer text.
  const current = state.doc.textBetween(range.from, range.to, '\0', '\0')
  if (query === undefined ? !current.startsWith('/') : current !== `/${query}`) return
  const chain = editor.chain().focus().deleteRange(range)
  switch (item.id) {
    case 'paragraph':
      chain.setParagraph().run()
      return
    case 'heading1':
    case 'heading2':
    case 'heading3':
      chain.setNode('heading', { level: Number(item.id.slice(-1)) }).run()
      return
    case 'bulletList':
      chain.toggleBulletList().run()
      return
    case 'orderedList':
      chain.toggleOrderedList().run()
      return
    case 'taskList':
      chain.toggleTaskList().run()
      return
    case 'blockquote':
      chain.toggleBlockquote().run()
      return
    case 'codeBlock':
      chain.setNode('codeBlock').run()
      return
    case 'mermaid':
      chain.setNode('codeBlock', { language: 'mermaid' }).run()
      return
    case 'blockMath':
      chain.insertContent({ type: 'blockMath', attrs: { latex: '' } }).run()
      return
    case 'table':
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      return
    case 'callout': {
      const callout = state.schema.nodes.callout
      if (!callout) return
      chain.wrapIn(callout, { calloutType: 'note', calloutTypeRaw: 'note' }).run()
      return
    }
    case 'horizontalRule':
      chain.setHorizontalRule().run()
      return
    case 'image':
      chain.run()
      void insertPickedImage(editor, options)
      return
    case 'link': {
      const url = window.prompt(i18n.t('writeLinkPromptUrl', { ns: 'common' }), 'https://')
      if (!url || !/^https?:\/\//i.test(url)) return
      chain.setLink({ href: url }).run()
      return
    }
  }
}

/**
 * `/` command menu (implementation §9.5): opens on `/` at line start or
 * after whitespace, filters block-type items by query, and applies them to
 * the containing block.
 */
export const WriteSlashMenu = Extension.create<WriteSlashMenuOptions>({
  name: 'writeSlashMenu',

  addOptions() {
    return {
      isReadOnly: () => false,
      getWorkspaceRoot: () => '',
      getFilePath: () => '',
      getImageDirectory: () => ''
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      // CJK IMEs type `、` (or full-width `／`) for the slash key — swap
      // it to `/` at a valid trigger position so the menu still opens;
      // `deleteRange` in the command path removes it like any `/` query.
      new Plugin({
        key: new PluginKey('writeSlashCjkTrigger'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (options.isReadOnly()) return null
          for (const tr of transactions) {
            if (!tr.docChanged) continue
            for (const step of tr.steps) {
              if (!(step instanceof ReplaceStep) || step.from !== step.to) continue
              const text = step.slice.content.textBetween(0, step.slice.content.size, '', '')
              if (text !== '、' && text !== '／') continue
              const pos = tr.mapping.map(step.from)
              const $from = newState.doc.resolve(pos)
              const parentName = $from.parent.type.name
              if (parentName === 'codeBlock' || parentName === 'inlineMath' || parentName === 'blockMath') {
                continue
              }
              const before = $from.parent.textBetween(
                Math.max(0, $from.parentOffset - 1),
                $from.parentOffset,
                undefined,
                '￼'
              )
              if ($from.parentOffset > 1 && !/\s/.test(before)) continue
              return newState.tr.insertText('/', pos, pos + 1)
            }
          }
          return null
        }
      }),
      Suggestion<SlashItem, SlashItem>({
        pluginKey: new PluginKey('writeSlashMenu'),
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allow: ({ editor, state, range }) => {
          if (options.isReadOnly() || !editor.isEditable) return false
          const $from = state.doc.resolve(range.from)
          const parentName = $from.parent.type.name
          if (parentName === 'codeBlock' || parentName === 'inlineMath' || parentName === 'blockMath') {
            return false
          }
          const before = $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 1),
            $from.parentOffset,
            undefined,
            '￼'
          )
          return $from.parentOffset <= 1 || /\s/.test(before)
        },
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props: item }) => {
          if (item) runItem(editor, range, undefined, item, options)
        },
        render: () => {
          let dom: HTMLElement | null = null
          let list: HTMLElement | null = null
          let items: SlashItem[] = []
          let selected = 0
          let stopAutoUpdate: (() => void) | null = null
          let latestProps: SuggestionProps<SlashItem, SlashItem> | null = null

          const paint = (): void => {
            if (!list) return
            list.textContent = ''
            items.slice(0, 12).forEach((item, index) => {
              const button = document.createElement('button')
              button.type = 'button'
              button.className = `write-slash-item${index === selected ? ' is-active' : ''}`
              const glyph = document.createElement('span')
              glyph.className = 'write-slash-item-glyph'
              glyph.textContent = item.glyph
              const label = document.createElement('span')
              label.className = 'write-slash-item-label'
              label.textContent = i18n.t(item.labelKey, { ns: 'common' })
              button.append(glyph, label)
              button.addEventListener('mousedown', (event) => event.preventDefault())
              button.addEventListener('click', () => {
                if (latestProps) runItem(latestProps.editor, latestProps.range, latestProps.query, item, options)
              })
              list?.append(button)
            })
          }

          const reposition = (): void => {
            if (!dom || !latestProps?.clientRect) return
            const rect = latestProps.clientRect()
            if (!rect) return
            void computePosition(
              { getBoundingClientRect: () => rect },
              dom,
              {
                placement: 'bottom-start',
                strategy: 'fixed',
                middleware: [offset(6), flip(), shift({ padding: 8 })]
              }
            ).then(({ x, y }) => {
              if (!dom) return
              const zoom = bodyZoom()
              dom.style.left = `${toLayoutPx(x, zoom)}px`
              dom.style.top = `${toLayoutPx(y, zoom)}px`
            })
          }

          return {
            onStart: (props) => {
              latestProps = props as SuggestionProps<SlashItem, SlashItem>
              items = props.items as SlashItem[]
              selected = 0
              dom = document.createElement('div')
              dom.className = 'write-slash-menu'
              list = document.createElement('div')
              list.className = 'write-slash-list'
              dom.append(list)
              document.body.append(dom)
              paint()
              const anchor = { getBoundingClientRect: () => latestProps?.clientRect?.() ?? new DOMRect() }
              stopAutoUpdate = autoUpdate(anchor, dom, reposition)
              reposition()
            },
            onUpdate: (props) => {
              latestProps = props as SuggestionProps<SlashItem, SlashItem>
              items = props.items as SlashItem[]
              selected = Math.min(selected, Math.max(0, items.length - 1))
              paint()
              reposition()
            },
            onKeyDown: (props) => {
              if (items.length === 0) return false
              if (props.event.key === 'ArrowDown') {
                selected = (selected + 1) % items.length
                paint()
                return true
              }
              if (props.event.key === 'ArrowUp') {
                selected = (selected - 1 + items.length) % items.length
                paint()
                return true
              }
              if (props.event.key === 'Enter') {
                const item = items[selected]
                if (item && latestProps) runItem(latestProps.editor, latestProps.range, latestProps.query, item, options)
                return true
              }
              return false
            },
            onExit: () => {
              stopAutoUpdate?.()
              stopAutoUpdate = null
              dom?.remove()
              dom = null
              list = null
              latestProps = null
            }
          }
        }
      })
    ]
  }
})
