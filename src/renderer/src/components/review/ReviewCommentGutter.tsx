import type { ReactElement } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Per-line comment affordance (docs/ade/11 §4.2): the "+" appears on row
 * hover; the parent row owns focus and forwards the `c` key.
 */
export function ReviewCommentGutter({
  onAdd,
  commentCount
}: {
  onAdd: () => void
  commentCount: number
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation()
        onAdd()
      }}
      aria-label={t('reviewAddComment')}
      title={t('reviewAddComment')}
      className={`flex h-5 w-4 shrink-0 items-center justify-center select-none text-ds-faint transition-opacity ${
        commentCount > 0
          ? 'opacity-100 text-sky-600 dark:text-sky-400'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
      } hover:bg-ds-hover hover:text-ds-ink`}
    >
      {commentCount > 0
        ? <span className="text-[10px] font-medium">{commentCount}</span>
        : <Plus className="h-3 w-3" strokeWidth={2.2} />}
    </button>
  )
}
