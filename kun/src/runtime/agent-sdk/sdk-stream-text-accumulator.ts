/** O(1)-append, lazily joined accumulator bounded by the enclosing byte/event budget. */
export class StreamTextAccumulator {
  private parts: string[] = []
  private joined: string | undefined

  append(text: string): void {
    if (!text) return
    this.parts.push(text)
    this.joined = undefined
  }

  replace(text: string): void {
    this.parts = text ? [text] : []
    this.joined = text
  }

  clear(): void {
    this.parts = []
    this.joined = ''
  }

  get value(): string {
    if (this.joined === undefined) {
      this.joined = this.parts.join('')
      this.parts = this.joined ? [this.joined] : []
    }
    return this.joined
  }
}
