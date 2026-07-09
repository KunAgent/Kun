declare module 'pdfjs-dist/build/pdf.mjs' {
  export type TextContentItem = { str?: string }
  export type TextContent = { items: TextContentItem[]; styles?: Record<string, unknown>; lang?: string }
  export type PageViewport = {
    width: number
    height: number
    scale: number
    rotation: number
    rawDims?: {
      pageWidth: number
      pageHeight: number
      pageX: number
      pageY: number
    }
  }
  export type RenderTask = {
    promise: Promise<unknown>
    cancel: () => void
  }
  export type PDFPageProxy = {
    getViewport: (options: { scale: number; rotation?: number }) => PageViewport
    render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PageViewport }) => RenderTask
    getTextContent: () => Promise<TextContent>
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
    rotation: number
  }
  export type RenderTask = {
    promise: Promise<unknown>
    cancel: () => void
  }
  export type PDFPageProxy = {
    getViewport: (options: { scale: number; rotation?: number }) => PageViewport
    render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PageViewport }) => RenderTask
    getTextContent: () => Promise<TextContent>
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
