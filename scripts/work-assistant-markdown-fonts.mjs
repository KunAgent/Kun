// Chromium can localize familyName on macOS (for example PingFang SC is
// reported as a Chinese family name). PostScript identity remains stable.
const knownCjkFamily = /^(?:Noto (?:Sans|Serif)(?: Mono)? CJK\b|PingFang\b|Hiragino (?:Sans|Kaku Gothic)\b)/
const verifiedPostScriptNames = new Set(['PingFangSC-Regular'])

export function countWorkAssistantCjkGlyphs(fonts) {
  return fonts.reduce((total, font) => {
    const known = knownCjkFamily.test(font.familyName ?? '')
      || verifiedPostScriptNames.has(font.postScriptName)
    // Count only actual platform glyph use, never a CSS font declaration,
    // an unrecognized fallback/tofu font, or an arbitrary downloaded font.
    if (!known || font.isCustomFont !== false || !Number.isSafeInteger(font.glyphCount) || font.glyphCount <= 0) return total
    return total + font.glyphCount
  }, 0)
}
