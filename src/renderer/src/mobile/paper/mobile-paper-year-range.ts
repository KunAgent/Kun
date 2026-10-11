export function mobilePaperYearRange(fromText: string, toText: string):
  { yearFrom?: number; yearTo?: number } | null {
  const yearFrom = fromText.trim() ? Number(fromText) : undefined
  const yearTo = toText.trim() ? Number(toText) : undefined
  const valid = (value: number | undefined): boolean => value === undefined ||
    (Number.isInteger(value) && value >= 1900 && value <= new Date().getFullYear() + 1)
  if (!valid(yearFrom) || !valid(yearTo) ||
    (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo)) return null
  return { yearFrom, yearTo }
}
