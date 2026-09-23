import { Image } from '@tiptap/extension-image'
import { isHtmlEmbedSrc } from '@shared/write-prototype'
import {
  initialWriteMarkdownImageSrc,
  loadWriteMarkdownImage
} from '../markdown-image'
import { parsePendingInfographicId } from '../infographic-pending'
import { createInfographicPendingElement } from '../infographic-pending-dom'
import { createHtmlEmbedElement } from '../html-embed-dom'
import { openWriteImageLightbox } from '../write-image-lightbox'

export type WriteLocalImageOptions = {
  /** Absolute path of the markdown file being edited; relative image
   * sources resolve against its directory. */
  getFilePath: () => string
  /** Workspace root the document belongs to; prototype embeds authorize against it. */
  getWorkspaceRoot: () => string
}

/**
 * Image node that keeps the raw (usually workspace-relative) `src` attribute
 * intact for markdown serialization while displaying the resolved file:// URL
 * inside the editor.
 */
export const WriteLocalImage = Image.extend<WriteLocalImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      getFilePath: () => '',
      getWorkspaceRoot: () => ''
    }
  },

  addNodeView() {
    return ({ node }) => {
      const pendingId = parsePendingInfographicId(
        typeof node.attrs.src === 'string' ? node.attrs.src : ''
      )
      if (pendingId !== null) {
        // Generating infographic: animated placeholder instead of an <img>.
        // Any src change recreates the view, which is how the placeholder
        // morphs into the real image once the token is replaced.
        return {
          dom: createInfographicPendingElement(pendingId),
          update: (updated) => {
            if (updated.type.name !== node.type.name) return false
            const updatedSrc = typeof updated.attrs.src === 'string' ? updated.attrs.src : ''
            return parsePendingInfographicId(updatedSrc) === pendingId
          }
        }
      }
      const rawSrc = typeof node.attrs.src === 'string' ? node.attrs.src : ''
      if (isHtmlEmbedSrc(rawSrc)) {
        // Generated HTML prototype: cover card + on-demand webview.
        return {
          dom: createHtmlEmbedElement({
            rawSrc,
            alt: typeof node.attrs.alt === 'string' ? node.attrs.alt : '',
            filePath: this.options.getFilePath() || null,
            workspaceRoot: this.options.getWorkspaceRoot() || null
          }),
          update: (updated) => {
            if (updated.type.name !== node.type.name) return false
            return updated.attrs.src === rawSrc
          }
        }
      }
      const dom = document.createElement('img')
      dom.className = 'write-rich-image'
      dom.alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
      const applySrc = (src: unknown): void => {
        const raw = typeof src === 'string' ? src : ''
        const filePath = this.options.getFilePath() || null
        const initialSrc = initialWriteMarkdownImageSrc(raw, filePath)
        if (initialSrc) {
          dom.src = initialSrc
        } else {
          dom.removeAttribute('src')
        }
        delete dom.dataset.localPath
        dom.classList.remove('write-rich-image-error')
        dom.removeAttribute('title')
        dom.dataset.rawSrc = raw
        void loadWriteMarkdownImage(raw, filePath)
          .then((result) => {
            if (dom.dataset.rawSrc !== raw) return
            if (result.ok) {
              dom.src = result.src
              if (result.localPath) dom.dataset.localPath = result.localPath
              else delete dom.dataset.localPath
              dom.classList.remove('write-rich-image-error')
              dom.removeAttribute('title')
              return
            }
            dom.removeAttribute('src')
            delete dom.dataset.localPath
            dom.classList.add('write-rich-image-error')
            dom.title = result.message
          })
          .catch((error) => {
            if (dom.dataset.rawSrc !== raw) return
            dom.removeAttribute('src')
            delete dom.dataset.localPath
            dom.classList.add('write-rich-image-error')
            dom.title = error instanceof Error ? error.message : String(error)
          })
      }
      applySrc(node.attrs.src)
      dom.addEventListener('dblclick', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!dom.src) return
        openWriteImageLightbox({
          src: dom.src,
          alt: dom.alt,
          ...(dom.dataset.localPath ? { localPath: dom.dataset.localPath } : {})
        })
      })
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== node.type.name) return false
          if (dom.dataset.rawSrc !== updated.attrs.src) applySrc(updated.attrs.src)
          dom.alt = typeof updated.attrs.alt === 'string' ? updated.attrs.alt : ''
          return true
        }
      }
    }
  }
})
