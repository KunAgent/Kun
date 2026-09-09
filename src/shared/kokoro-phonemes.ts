/**
 * Kokoro phoneme vocabulary and phoneme post-processing.
 *
 * The model consumes IPA phonemes produced by espeak-ng, mapped through the
 * vocabulary published with the ONNX export. Non-ASCII characters are required
 * here: they are the IPA symbols themselves.
 */
import { LOCAL_KOKORO_MAX_TOKENS } from './local-kokoro'

/** Boundary token wrapped around every sequence (the `$` entry). */
export const KOKORO_BOUNDARY_TOKEN = 0

/** Character -> token id, copied verbatim from the published tokenizer. */
export const KOKORO_VOCAB: Record<string, number> = {
  '$': 0, ';': 1, ':': 2, ',': 3, '.': 4, '!': 5,
  '?': 6, '—': 9, '…': 10, '"': 11, '(': 12, ')': 13,
  '“': 14, '”': 15, ' ': 16, '̃': 17, 'ʣ': 18, 'ʥ': 19,
  'ʦ': 20, 'ʨ': 21, 'ᵝ': 22, 'ꭧ': 23, 'A': 24, 'I': 25,
  'O': 31, 'Q': 33, 'S': 35, 'T': 36, 'W': 39, 'Y': 41,
  'ᵊ': 42, 'a': 43, 'b': 44, 'c': 45, 'd': 46, 'e': 47,
  'f': 48, 'h': 50, 'i': 51, 'j': 52, 'k': 53, 'l': 54,
  'm': 55, 'n': 56, 'o': 57, 'p': 58, 'q': 59, 'r': 60,
  's': 61, 't': 62, 'u': 63, 'v': 64, 'w': 65, 'x': 66,
  'y': 67, 'z': 68, 'ɑ': 69, 'ɐ': 70, 'ɒ': 71, 'æ': 72,
  'β': 75, 'ɔ': 76, 'ɕ': 77, 'ç': 78, 'ɖ': 80, 'ð': 81,
  'ʤ': 82, 'ə': 83, 'ɚ': 85, 'ɛ': 86, 'ɜ': 87, 'ɟ': 90,
  'ɡ': 92, 'ɥ': 99, 'ɨ': 101, 'ɪ': 102, 'ʝ': 103, 'ɯ': 110,
  'ɰ': 111, 'ŋ': 112, 'ɳ': 113, 'ɲ': 114, 'ɴ': 115, 'ø': 116,
  'ɸ': 118, 'θ': 119, 'œ': 120, 'ɹ': 123, 'ɾ': 125, 'ɻ': 126,
  'ʁ': 128, 'ɽ': 129, 'ʂ': 130, 'ʃ': 131, 'ʈ': 132, 'ʧ': 133,
  'ʊ': 135, 'ʋ': 136, 'ʌ': 138, 'ɣ': 139, 'ɤ': 140, 'χ': 142,
  'ʎ': 143, 'ʒ': 147, 'ʔ': 148, 'ˈ': 156, 'ˌ': 157, 'ː': 158,
  'ʰ': 162, 'ʲ': 164, '↓': 169, '→': 171, '↗': 172, '↘': 173,
  'ᵻ': 177
}

/** Characters espeak keeps verbatim; they carry Kokoro's pauses and prosody. */
export const KOKORO_PUNCTUATION = ';:,.!?¡¿—…"«»“” '

const PUNCTUATION_RUN = /([;:,.!?¡¿—…"«»“”]+\s*|\s+)/
/** Anything that is neither punctuation nor whitespace must go through espeak. */
const SPEAKABLE_CHARACTER = /[^\s;:,.!?¡¿—…"«»“”]/

export type KokoroTextSegment = {
  /** True when the segment is punctuation/whitespace and must not be phonemized. */
  literal: boolean
  text: string
}

/**
 * Split text so punctuation runs survive phonemization untouched. espeak drops
 * commas and periods, and Kokoro needs them for pauses.
 */
export function splitKokoroSegments(text: string): KokoroTextSegment[] {
  if (typeof text !== 'string' || !text) return []
  const segments: KokoroTextSegment[] = []
  for (const piece of text.split(PUNCTUATION_RUN)) {
    if (!piece) continue
    segments.push({ literal: !SPEAKABLE_CHARACTER.test(piece), text: piece })
  }
  return segments
}

/**
 * Pronunciation fixes applied to raw espeak output, matching the reference
 * Kokoro implementation.
 */
export function applyKokoroPhonemeRules(phonemes: string, language: 'en-us' | 'en-gb'): string {
  let value = phonemes
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
  if (language === 'en-us') {
    value = value.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
  }
  return value.trim()
}

/** Map phonemes to token ids, dropping characters outside the vocabulary. */
export function tokenizeKokoroPhonemes(phonemes: string): number[] {
  const tokens: number[] = []
  for (const character of phonemes) {
    const id = KOKORO_VOCAB[character]
    if (id !== undefined) tokens.push(id)
  }
  return tokens
}

/**
 * Wrap tokens in boundary markers. Sequences longer than the voice file can
 * index are split, so every returned sequence is safe to run.
 */
export function kokoroTokenSequences(phonemes: string): number[][] {
  const tokens = tokenizeKokoroPhonemes(phonemes)
  if (tokens.length === 0) return []
  const budget = LOCAL_KOKORO_MAX_TOKENS - 2
  if (tokens.length <= budget) return [[KOKORO_BOUNDARY_TOKEN, ...tokens, KOKORO_BOUNDARY_TOKEN]]
  const sequences: number[][] = []
  const spaceToken = KOKORO_VOCAB[' ']
  let start = 0
  while (start < tokens.length) {
    let end = Math.min(start + budget, tokens.length)
    if (end < tokens.length) {
      // Prefer breaking on a word boundary so words are not cut in half.
      for (let index = end - 1; index > start + Math.floor(budget / 2); index -= 1) {
        if (tokens[index] === spaceToken) {
          end = index
          break
        }
      }
    }
    sequences.push([KOKORO_BOUNDARY_TOKEN, ...tokens.slice(start, end), KOKORO_BOUNDARY_TOKEN])
    start = end
    while (start < tokens.length && tokens[start] === spaceToken) start += 1
  }
  return sequences
}
