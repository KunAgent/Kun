import { lint } from '@google/design.md/linter'
import type { ProjectDesignMdOfficialLintResult } from '../../shared/project-design-md'

export function lintProjectDesignMd(content: string): ProjectDesignMdOfficialLintResult {
  try {
    const report = lint(content)
    return {
      ok: true,
      findings: report.findings.map((finding) => {
        // The upstream declarations still infer this enum through Zod 3 types.
        // Validate the boundary explicitly when resolving against patched Zod 4.
        const severity = finding.severity
        if (severity !== 'error' && severity !== 'warning' && severity !== 'info') {
          throw new Error('Invalid Google DESIGN.md finding severity.')
        }
        return {
          severity,
          message: finding.message,
          ...(finding.path ? { path: finding.path } : {})
        }
      }),
      colors: Object.fromEntries([...report.designSystem.colors].map(([name, value]) => [name, { hex: value.hex, luminance: value.luminance }])),
      typography: Object.fromEntries([...report.designSystem.typography].map(([name, value]) => [name, {
        ...(value.fontFamily ? { fontFamily: value.fontFamily } : {}),
        ...(value.fontSize ? { fontSize: { value: value.fontSize.value, unit: value.fontSize.unit } } : {}),
        ...(value.fontWeight ? { fontWeight: value.fontWeight } : {}),
        ...(value.lineHeight ? { lineHeight: { value: value.lineHeight.value, unit: value.lineHeight.unit } } : {}),
        ...(value.letterSpacing ? { letterSpacing: { value: value.letterSpacing.value, unit: value.letterSpacing.unit } } : {})
      }])),
      rounded: Object.fromEntries([...report.designSystem.rounded].map(([name, value]) => [name, { value: value.value, unit: value.unit }])),
      spacing: Object.fromEntries([...report.designSystem.spacing].map(([name, value]) => [name, { value: value.value, unit: value.unit }])),
      sections: [...report.sections]
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Google DESIGN.md linter failed.' }
  }
}
