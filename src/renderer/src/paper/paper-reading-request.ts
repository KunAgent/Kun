export type PaperReadingPurpose = 'quick-screen' | 'method-deep-read' | 'reproduction-prep' | 'review-critique'

export const PAPER_READING_PURPOSES: readonly PaperReadingPurpose[] = [
  'quick-screen', 'method-deep-read', 'reproduction-prep', 'review-critique'
]

/** Bounded single-request reading instructions (batch interpretation). */
export function paperReadingQuestion(purpose: PaperReadingPurpose, input: {
  background: string; goal: string; question: string; limited: boolean
}): string {
  const aims: Record<PaperReadingPurpose, string> = {
    'quick-screen': 'Quickly screen relevance: state the problem, method, author-reported result, limitations and whether deeper reading is justified. Keep it brief. Do not make a whiteboard.',
    'method-deep-read': 'Explain the method, assumptions, original notation and units, algorithm steps and evaluation conditions. Define prerequisite terms only if needed for the stated background.',
    'reproduction-prep': 'Prepare a bounded reproduction checklist from reported code, data versions, splits, environment, hardware and parameters. Identify missing details explicitly. Do not execute or download anything.',
    'review-critique': 'Critique claim support, baselines, evaluation comparability, ablations, limitations and validity threats. Distinguish author-reported statements from your inferences.'
  }
  return [
    aims[purpose],
    'Use only the frozen sources supplied for this turn. Cite page/section locators and a short exact original quote for important claims. Preserve symbols, units, negation and qualifiers. Missing information is “not reported”. A matched quote does not prove a claim is true.',
    'Respond in the language of the user question or research goal; if neither specifies a language, follow the conversation interface language requested below.',
    input.limited ? 'Material is incomplete or abstract-only. Explicitly label the answer as limited-material screening; do not claim to have reviewed the full paper.' : '',
    input.background.trim() ? `User background: ${input.background.trim()}` : '',
    input.goal.trim() ? `Research goal: ${input.goal.trim()}` : '',
    input.question.trim() ? `User question: ${input.question.trim()}` : ''
  ].filter(Boolean).join('\n\n')
}
