// Deep imports on purpose: the `lucide` barrel re-exports ~1,600 icon modules,
// and Rollup loads and transforms every one of them even though tree-shaking
// drops the unused code. That pushed the renderer build past the 4 GiB heap
// cap on the macOS packaging runner. Add new icons here as single files.
import ChevronRight from 'lucide/dist/esm/icons/chevron-right.js'
import Copy from 'lucide/dist/esm/icons/copy.js'
import CopyPlus from 'lucide/dist/esm/icons/copy-plus.js'
import Ellipsis from 'lucide/dist/esm/icons/ellipsis.js'
import GripVertical from 'lucide/dist/esm/icons/grip-vertical.js'
import Plus from 'lucide/dist/esm/icons/plus.js'
import Repeat2 from 'lucide/dist/esm/icons/repeat-2.js'
import Scissors from 'lucide/dist/esm/icons/scissors.js'
import Trash2 from 'lucide/dist/esm/icons/trash-2.js'
import createElement from 'lucide/dist/esm/createElement.js'

export {
  ChevronRight,
  Copy,
  CopyPlus,
  createElement,
  Ellipsis,
  GripVertical,
  Plus,
  Repeat2,
  Scissors,
  Trash2
}
