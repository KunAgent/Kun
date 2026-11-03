import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
export const selectionHoldEffect = StateEffect.define<{ from: number; to: number } | null>()
export const markdownSelectionHold = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(selectionHoldEffect)) {
      const range = effect.value
      value = range && range.from < range.to && range.to <= tr.newDoc.length
        ? Decoration.set([Decoration.mark({ class: 'write-selection-hold' }).range(range.from, range.to)])
        : Decoration.none
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field)
})
