import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { Node } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Room } from '@shared/rooms-api'
import { useTranslation } from 'react-i18next'
import { ROOM_ALL_MENTION, roomMentionToken, roomRichContent, roomRichDraft } from './room-mentions'

export type RoomRichInputHandle = { focus(): void; insertText(text: string): void; insertMention(id: string): void }
const RoomMention = Node.create({ name: 'roomMention', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ id: { default: '' }, label: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-room-mention]' }],
  renderHTML: ({ node }) => ['span', { 'data-room-mention': node.attrs.id, class: 'rooms-inline-mention', contenteditable: 'false' }, '@' + node.attrs.label],
  renderText: ({ node }) => roomMentionToken(String(node.attrs.id), String(node.attrs.label)) })

export const RoomRichInput = forwardRef<RoomRichInputHandle, {
  room: Room; value: string; mentions: string[]; disabled?: boolean; placeholder: string;
  onChange: (value: { body: string; mentions: string[] }) => void; onSubmit: () => void; onPasteFiles?: (files: FileList) => void
}>(function RoomRichInput(props, ref) {
  const { t } = useTranslation('common')
  const menuId = useId()
  const latest = useRef(props); latest.current = props
  const [query, setQuery] = useState<string | null>(null), [selected, setSelected] = useState(0)
  const queryRef = useRef(query); queryRef.current = query
  const selectedRef = useRef(selected); selectedRef.current = selected
  const range = useRef({ from: 0, to: 0 }), candidatesRef = useRef<Array<{ id: string; label: string }>>([])
  const chooseRef = useRef<(id: string) => void>(() => {})
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ blockquote: false, bold: false, italic: false, underline: false, strike: false,
      bulletList: false, orderedList: false, listItem: false, listKeymap: false, code: false, codeBlock: false,
      heading: false, horizontalRule: false, link: false, dropcursor: false, gapcursor: false, trailingNode: false }), RoomMention],
    content: roomRichContent(props.value, props.mentions), editable: !props.disabled,
    onUpdate: ({ editor }) => {
      const value = roomRichDraft(editor.getJSON())
      if (value.body.length > 64000) { editor.commands.setContent(roomRichContent(latest.current.value, latest.current.mentions), { emitUpdate: false }); return }
      latest.current.onChange(value)
    },
    onSelectionUpdate: ({ editor }) => {
      const { $from, from, empty } = editor.state.selection
      const match = empty ? /(?:^|\s)@([^@\s]*)$/.exec(editor.state.doc.textBetween($from.start(), from, '\n', '\ufffc')) : null
      setQuery(match?.[1] ?? null); setSelected(0)
      if (match) range.current = { from: from - match[1].length - 1, to: from }
    },
    editorProps: {
      attributes: { class: 'rooms-rich-input', role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.placeholder, 'data-placeholder': props.placeholder },
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing || event.keyCode === 229) return false
        if (queryRef.current !== null) {
          if (event.key === 'Escape') { setQuery(null); return true }
          const choices = candidatesRef.current
          if (choices.length && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            setSelected((value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length); return true
          }
          if (event.key === 'Enter' && choices[selectedRef.current]) { chooseRef.current(choices[selectedRef.current].id); return true }
        }
        if (event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey)) { event.preventDefault(); latest.current.onSubmit(); return true }
        return false
      },
      handlePaste: (view, event) => {
        if (event.clipboardData?.files.length) { latest.current.onPasteFiles?.(event.clipboardData.files); return true }
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return false
        view.dispatch(view.state.tr.insertText(text.slice(0, Math.max(0, 64000 - latest.current.value.length))))
        return true
      }
    }
  }, [])
  const choices = [{ id: ROOM_ALL_MENTION, label: t('roomsMentionAll') }, ...props.room.members
    .filter((member) => member.enabled && !member.removedAt).map((member) => ({ id: member.id, label: member.displayName }))]
    .filter((member) => member.label.toLocaleLowerCase().includes((query ?? '').toLocaleLowerCase()) || member.id === ROOM_ALL_MENTION && 'all'.includes((query ?? '').toLowerCase()))
  candidatesRef.current = choices
  const choose = (id: string) => {
    if (!editor) return
    const member = id === ROOM_ALL_MENTION ? { label: t('roomsMentionAll') } : props.room.members.find((value) => value.id === id)
    if (!member) return
    editor.chain().focus().insertContentAt(query !== null ? range.current : editor.state.selection,
      [{ type: 'roomMention', attrs: { id, label: 'label' in member ? member.label : member.displayName } }, { type: 'text', text: ' ' }]).run()
    setQuery(null)
  }
  chooseRef.current = choose
  useImperativeHandle(ref, () => ({ focus: () => { editor?.commands.focus() },
    insertText: (text) => { editor?.chain().focus().insertContent({ type: 'text', text }).run() }, insertMention: choose }))
  useEffect(() => {
    if (editor && roomRichDraft(editor.getJSON()).body !== props.value) editor.commands.setContent(roomRichContent(props.value, props.mentions), { emitUpdate: false })
  }, [editor, props.value, props.mentions])
  useEffect(() => { editor?.setEditable(!props.disabled) }, [editor, props.disabled])
  useEffect(() => {
    editor?.setOptions({ editorProps: { ...editor.options.editorProps, attributes: {
      class: 'rooms-rich-input', role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.placeholder,
      'data-placeholder': props.placeholder, 'aria-autocomplete': 'list',
      ...(query !== null && choices.length ? { 'aria-controls': menuId, 'aria-activedescendant': `${menuId}-${selected}` } : {})
    } } })
  }, [editor, props.placeholder, query, choices.length, menuId, selected])
  return <div className="rooms-rich-input-wrap">
    <EditorContent editor={editor} />
    {query !== null && choices.length ? <div id={menuId} className="rooms-rich-mentions" role="listbox" aria-label={t('roomsMention')}>
      {choices.map((member, index) => <button id={`${menuId}-${index}`} role="option" aria-selected={index === selected} type="button" key={member.id}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(member.id)}>@{member.label}</button>)}
    </div> : null}
  </div>
})
