declare module 'pdfjs-dist/build/pdf.mjs' {
  export type TextContentItem = {
    str?: string
    /** [a, b, c, d, x, y] in user space (origin bottom-left). */
    transform?: number[]
    width?: number
    height?: number
    fontName?: string
  }
  export type TextContent = { items: TextContentItem[]; styles?: Record<string, unknown>; lang?: string }
  export type PDFAnnotation = {
    annotationType?: number
    subtype?: string
    /** [x1, y1, x2, y2] in user space. */
    rect?: number[]
    url?: string
    unsafeUrl?: string
    dest?: unknown
    destName?: string
  }
  export type PageViewport = {
    width: number
    height: number
    scale: number
    userUnit: number
    rotation: number
    rawDims?: {
      pageWidth: number
      pageHeight: number
      pageX: number
      pageY: number
    }
    convertToViewportRectangle: (rect: number[]) => number[]
  }
  export type RenderTask = {
    promise: Promise<unknown>
    cancel: () => void
  }
  export type PDFPageProxy = {
    getViewport: (options: { scale: number; rotation?: number }) => PageViewport
    render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PageViewport }) => RenderTask
    getTextContent: () => Promise<TextContent>
    getAnnotations: (options?: { intent?: string }) => Promise<PDFAnnotation[]>
    cleanup: () => void
  }
  export type PDFOutlineItem = {
    title: string
    dest: string | unknown[] | null
    items?: PDFOutlineItem[]
  }
  export type PDFDocumentProxy = {
    numPages: number
    getPage: (pageNumber: number) => Promise<PDFPageProxy>
    getOutline: () => Promise<PDFOutlineItem[] | null>
    getDestination: (id: string) => Promise<unknown[] | null>
    getPageIndex: (ref: unknown) => Promise<number>
    destroy: () => Promise<void>
  }
  export type PDFDocumentLoadingTask = {
    promise: Promise<PDFDocumentProxy>
    destroy: () => void
  }
  export const GlobalWorkerOptions: { workerSrc: string }
  export class TextLayer {
    constructor(options: {
      textContentSource: TextContent
      container: HTMLElement
      viewport: PageViewport
    })
    render(): Promise<void>
  }
  export function getDocument(options: unknown): PDFDocumentLoadingTask
}

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export type TextContentItem = { str?: string }
  export type TextContent = { items: TextContentItem[]; styles?: Record<string, unknown>; lang?: string }
  export type PageViewport = {
    width: number
    height: number
    scale: number
    userUnit: number
    rotation: number
  }
  export type RenderTask = {
    promise: Promise<unknown>
    cancel: () => void
  }
  export type PDFOperatorList = {
    fnArray: number[]
    argsArray: unknown[][]
  }
  export const OPS: Record<string, number>
  export type PDFPageProxy = {
    getViewport: (options: { scale: number; rotation?: number }) => PageViewport
    render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PageViewport }) => RenderTask
    getTextContent: () => Promise<TextContent>
    getOperatorList: () => Promise<PDFOperatorList>
    cleanup: () => void
  }
  export type PDFDocumentProxy = {
    numPages: number
    getPage: (pageNumber: number) => Promise<PDFPageProxy>
    destroy: () => Promise<void>
  }
  export type PDFDocumentLoadingTask = {
    promise: Promise<PDFDocumentProxy>
    destroy: () => void
  }
  export function getDocument(options: unknown): PDFDocumentLoadingTask
}

declare module 'pdfjs-dist/web/pdf_viewer.mjs' {
  import type { PDFPageProxy, PageViewport } from 'pdfjs-dist/build/pdf.mjs'

  export class TextLayerBuilder {
    div: HTMLDivElement
    constructor(options: {
      pdfPage: PDFPageProxy
      onAppend?: (div: HTMLDivElement) => void
    })
    render(options: { viewport: PageViewport; textContentParams?: unknown }): Promise<void>
    cancel(): void
  }
}
