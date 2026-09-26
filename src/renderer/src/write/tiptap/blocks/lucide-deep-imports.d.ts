declare module 'lucide/dist/esm/icons/*.js' {
  import type { IconNode } from 'lucide'
  const icon: IconNode
  export default icon
}

declare module 'lucide/dist/esm/createElement.js' {
  import type { createElement } from 'lucide'
  const create: typeof createElement
  export default create
}
