declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string })
    readonly window: Window & {
      close(): void
      Element: typeof Element
      HTMLElement: typeof HTMLElement
    }
  }
}
