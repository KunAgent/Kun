/**
 * Produce a fingerprint of overlapping n-grams for a string. ASCII/Latin
 * segments are tokenized on word boundaries and down to trigrams, while CJK
 * runs are split into bigrams. Lower-cased, de-spaced. This keeps matching
 * language-agnostic without pulling in a tokenizer dependency.
 */
export function ngrams(input: string): Set<string> {
  const grams = new Set<string>()
  const normalized = input.toLowerCase()
  // Pull out ASCII words (letters/digits/underscore) and CJK runs separately.
  const asciiWords = normalized.match(/[a-z0-9_]{3,}/g) ?? []
  for (const word of asciiWords) {
    for (let i = 0; i + 3 <= word.length; i += 1) {
      grams.add(word.slice(i, i + 3))
    }
  }
  const cjkRuns = normalized.match(/[一-鿿぀-ヿ가-힯]+/g) ?? []
  for (const run of cjkRuns) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      grams.add(run.slice(i, i + 2))
    }
    if (run.length < 2) grams.add(run)
  }
  return grams
}
