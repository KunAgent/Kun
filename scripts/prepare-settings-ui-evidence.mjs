import { mkdir, readdir, readFile, writeFile, stat, copyFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

// Preserve all original evidence. The separate bounded review artifact can be
// downloaded by tools with a 32 MiB file limit, even for a full native matrix.
const source = resolve(process.env.KUN_SETTINGS_EVIDENCE || 'dist/settings-ui')
const review = resolve('dist/settings-ui-review')
const reports = resolve('dist/settings-ui-reports')
const budget = 24 * 1024 * 1024
// These are generated derivative outputs only; originals in source stay intact.
await rm(review, { recursive: true, force: true })
await rm(reports, { recursive: true, force: true })
const groups = new Map()
const regressionKeys = new Set()
const manifest = { budgetBytes: budget, copiedBytes: 0, included: [], omitted: [], reports: [] }
for (const phase of ['before', 'after']) {
  const files = await readdir(join(source, phase)).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const file of files) {
    const path = join(source, phase, file)
    if (!(await stat(path)).isFile()) continue
    const bytes = (await stat(path)).size
    if (file.endsWith('.png')) {
      const key = file.replace(/^(before|after)-/, '')
      const group = groups.get(key) ?? []
      group.push({ phase, file, bytes })
      groups.set(key, group)
    } else if (/\.(json|log|txt)$/.test(file)) {
      await mkdir(join(reports, phase), { recursive: true })
      const compressed = gzipSync(await readFile(path))
      await writeFile(join(reports, phase, `${file}.gz`), compressed)
      manifest.reports.push({ phase, file: `${file}.gz`, bytes: compressed.length })
      if (phase === 'after' && file === 'report.json') {
        const report = JSON.parse(await readFile(path, 'utf8'))
        for (const finding of [...(report.baselineComparison?.regressions ?? []),
          ...(report.requiredPolishFindings ?? [])]) regressionKeys.add(finding.key)
      }
    }
  }
}
const priority = key => key === 'failure.png' || key.includes('-obstruction.png') ? -2
  : regressionKeys.has(key.replace(/\.png$/, '')) ? -1
    : /-detail-general-switch\.png$|-detail-gateway-(?:connection-controls|client-menu)\.png$|small-200-.*-detail-model-route-tabs\.png$/.test(key) ? -0.5
    : /subagents-.*tab-profiles|ssh-add-dialog|destructive-confirm|small-200-providers-.*(?:model-routes-settings-tab|provider-workspace-tab-routes)/.test(key) ? 0
  : /light-wide-125-.*-landing/.test(key) ? 1
    : /dark-wide-125-.*-landing/.test(key) ? 2
      : /light-small-200-.*-landing/.test(key) ? 3
        : /dark-small-200-.*-landing/.test(key) ? 4
          : /ssh-add-dialog|busy-disabled|destructive-confirm/.test(key) ? 5 : 6
for (const [key, files] of [...groups].sort(([a], [b]) => priority(a) - priority(b) || a.localeCompare(b))) {
  const bytes = files.reduce((total, file) => total + file.bytes, 0)
  if (manifest.copiedBytes + bytes > budget) {
    manifest.omitted.push({ key, files, reason: 'Review byte budget; retained in full evidence artifact' })
    continue
  }
  for (const file of files) {
    await mkdir(join(review, file.phase), { recursive: true })
    await copyFile(join(source, file.phase, file.file), join(review, file.phase, file.file))
  }
  manifest.copiedBytes += bytes
  manifest.included.push({ key, matchedBeforeAfter: files.length === 2, files })
}
await mkdir(review, { recursive: true })
await mkdir(reports, { recursive: true })
const serialized = JSON.stringify(manifest, null, 2)
await writeFile(join(review, 'manifest.json'), serialized)
await writeFile(join(reports, 'manifest.json'), serialized)
const reportBytes = manifest.reports.reduce((total, file) => total + file.bytes, 0)
if (reportBytes + Buffer.byteLength(serialized) > budget) {
  throw new Error(`Compressed reports exceed review download budget: ${reportBytes}`)
}
console.log(`Review: ${manifest.included.length} screenshot groups, ${manifest.copiedBytes} PNG bytes; reports: ${reportBytes} gzip bytes`)
