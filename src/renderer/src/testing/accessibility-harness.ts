export type AccessibilityIssue = {
  rule: 'interactive-name' | 'form-label' | 'dialog-semantics' | 'duplicate-id'
  element: string
  message: string
}

export function auditStaticMarkup(markup: string): AccessibilityIssue[] {
  const issues: AccessibilityIssue[] = []
  const ids = collectIds(markup, issues)

  for (const match of markup.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const [, tag, attributes, contents] = match
    if (isHidden(attributes)) continue
    const name = firstAttribute(attributes, 'aria-label') ??
      firstAttribute(attributes, 'title') ??
      textContent(contents)
    const labelledBy = firstAttribute(attributes, 'aria-labelledby')
    if ((!name || !name.trim()) && (!labelledBy || !hasReferencedIds(labelledBy, ids))) {
      issues.push({
        rule: 'interactive-name',
        element: tag.toLowerCase(),
        message: `${tag.toLowerCase()} must have visible text, an aria-label, or a valid aria-labelledby reference`
      })
    }
  }

  for (const match of markup.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const [, tag, attributes] = match
    if (isHidden(attributes) || firstAttribute(attributes, 'type')?.toLowerCase() === 'hidden') continue
    const hasName = firstAttribute(attributes, 'aria-label') || firstAttribute(attributes, 'aria-labelledby')
    const id = firstAttribute(attributes, 'id')
    const hasLabel = id !== undefined && new RegExp(`<label\\b[^>]*\\bfor=["']${escapeRegExp(id)}["']`, 'i').test(markup)
    if (!hasName && !hasLabel) {
      issues.push({
        rule: 'form-label',
        element: tag.toLowerCase(),
        message: `${tag.toLowerCase()} must have an aria label or an associated label element`
      })
    }
  }

  for (const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const [, tag, attributes] = match
    if (firstAttribute(attributes, 'role')?.toLowerCase() !== 'dialog' || isHidden(attributes)) continue
    const hasModal = firstAttribute(attributes, 'aria-modal')?.toLowerCase() === 'true'
    const label = firstAttribute(attributes, 'aria-label')
    const labelledBy = firstAttribute(attributes, 'aria-labelledby')
    if (!hasModal || (!label && (!labelledBy || !hasReferencedIds(labelledBy, ids)))) {
      issues.push({
        rule: 'dialog-semantics',
        element: tag.toLowerCase(),
        message: 'dialog must declare aria-modal="true" and an accessible name'
      })
    }
  }

  return issues
}

function collectIds(markup: string, issues: AccessibilityIssue[]): Set<string> {
  const ids = new Set<string>()
  for (const match of markup.matchAll(/\bid=["']([^"']+)["']/gi)) {
    const id = match[1]
    if (!id) continue
    if (ids.has(id)) {
      issues.push({ rule: 'duplicate-id', element: '*', message: `duplicate id: ${id}` })
    }
    ids.add(id)
  }
  return ids
}

function firstAttribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
}

function hasReferencedIds(value: string, ids: Set<string>): boolean {
  const references = value.split(/\s+/).filter(Boolean)
  return references.length > 0 && references.every((id) => ids.has(id))
}

function isHidden(attributes: string): boolean {
  return firstAttribute(attributes, 'aria-hidden')?.toLowerCase() === 'true'
}

function textContent(value: string): string {
  return value
    .replace(/<([a-z][\w-]*)\b[^>]*\baria-hidden=["']true["'][^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
