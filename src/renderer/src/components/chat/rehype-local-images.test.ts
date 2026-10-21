import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { harden } from 'rehype-harden'
import { localImageSource, rehypeLocalImages } from './rehype-local-images'

function imgSrc(markdown: string): string | undefined {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeLocalImages)
    .use(harden, { allowedLinkPrefixes: ['*'], allowedProtocols: ['kun-image:'], allowedImagePrefixes: ['*'] })
  const tree = processor.runSync(processor.parse(markdown)) as { children: Array<{ children?: Array<{ tagName?: string; properties?: { src?: string } }> }> }
  return tree.children.flatMap((node) => node.children ?? []).find((child) => child.tagName === 'img')?.properties?.src
}

describe('rehypeLocalImages', () => {
  it('lets workspace-relative and absolute image paths through the sanitizer', () => {
    expect(localImageSource(imgSrc('![封面](images/a.png)'))).toBe('images/a.png')
    expect(localImageSource(imgSrc('![x](/Users/me/ws/cover.png)'))).toBe('/Users/me/ws/cover.png')
  })
  it('leaves remote images to the sanitizer unchanged', () => {
    expect(imgSrc('![x](https://example.com/a.png)')).toBe('https://example.com/a.png')
    expect(localImageSource('https://example.com/a.png')).toBeNull()
  })
})
