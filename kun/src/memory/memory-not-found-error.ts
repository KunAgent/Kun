/** Missing and out-of-scope records deliberately share one public error. */
export class MemoryNotFoundError extends Error {
  constructor() {
    super('memory not found')
    this.name = 'MemoryNotFoundError'
  }
}
