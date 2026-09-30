type PaperQuestion = {
  text: string
  libraryRoot: string
  unitDir: string
  page: number
  quote: { text: string; page: number } | null
}

/** Paper units have no active Work document fence; identify the unit and page in each turn. */
export function buildMobilePaperQuestion(input: PaperQuestion): string {
  const currentPage = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page)) : 1
  const context = `[paper-reading] library=${input.libraryRoot}; unit=${input.unitDir}; page=${currentPage}`
  const citation = input.quote
    ? `\n\n引用（第 ${input.quote.page} 页）：\n> ${input.quote.text.slice(0, 8000)}` : ''
  return `${input.text.trim()}\n\n${context}${citation}`
}
