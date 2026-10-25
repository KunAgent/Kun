import type { StyledText, TextRenderable } from '@opentui/core'
import type { TextProps } from '@opentui/solid'
import { createEffect, splitProps, type JSX } from 'solid-js'

type TextElementProps = Omit<TextProps, 'content' | 'ref' | 'children'>

/**
 * Text element with styled content. The Solid reconciler stringifies the
 * `content` prop, so styled chunks are assigned to the renderable directly.
 */
export function Txt(props: TextElementProps & { content: StyledText }): JSX.Element {
  const [local, rest] = splitProps(props, ['content'])
  let element: TextRenderable | undefined
  createEffect(() => {
    const content = local.content
    if (element && !element.isDestroyed) element.content = content
  })
  return (
    <text
      {...rest}
      ref={(value: TextRenderable) => {
        element = value
        value.content = local.content
      }}
    />
  )
}
