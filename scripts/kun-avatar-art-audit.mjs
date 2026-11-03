import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetPath } from './kun-avatar-art-validation.mjs'
import { alphaMask, AVATAR_FACEBOX_CANDIDATES, cropCoverage, darkEdgeRowWidth, detailDensity,
  effectCoverage, eyebrowPixels, featherHue, lowContrastRatio, outlineDistanceWidth,
  quantizedColorCount, rasterDifference, readAvatarPixels, silhouetteIou } from './kun-avatar-art-metrics.mjs'

export async function auditAvatarArt(manifest, shared, root, options = {}) {
  const images = new Map(), masks = new Map()
  const get = async (key) => {
    if (!images.has(key)) images.set(key, await readAvatarPixels(assetPath(root, manifest.assets[key].png)))
    return images.get(key)
  }
  const report = { schemaVersion: 2, metricConventions: {
    luminance: 'WCAG sRGB linear relative luminance', opaqueAlpha: 200,
    detail: 'Absolute horizontal + vertical luminance differences; each opaque pair counted once; divide by opaque pixels',
    colors: 'Opaque RGB channels floor-divided by 32', silhouette: 'Sharp Lanczos3 resize to 48px then alpha >=96',
    outline: 'Distance from opaque dark exterior contour to nearest opaque non-dark fill; all samples included',
    rowRun: 'From first alpha>=200 pixel on each occupied row; consecutive luminance<0.03; zero runs retained',
    fxFaceBox: 'Zero overlap applies to foreground stars; F4 backlight center is inside faceBox but hidden behind the body'
  }, icons: [], silhouettes: {}, materials: [], outlines: [], scenes: [], effects: [], faces: [], hats: [],
  featherColors: [], hueSpacing: [], failures: [], warnings: [], pending: [], reviewStatus: {
    featherColors: options.approvedFeatherColors ? 'approved' : 'awaiting-user-A/B',
    silhouetteRecognition: 'requires-user-recognition-score', materialAndStyle: 'requires-visual-review',
    outlineClassifier: 'luminance<0.03 does not include prescribed #0e2f66 (0.030857); inspect alongside row-run proxy'
  } }
  const issue = (array, code, key, measured, expected) => report[array].push({ code, key, measured, expected })
  for (const category of shared.KUN_AVATAR_ACCESSORY_CATEGORIES) {
    const parts = shared.KUN_AVATAR_CATALOG[category]
    for (const part of parts) {
      const key = `icon/${category}/${part.id}`, icon = await get(key)
      const contrast = Object.fromEntries(['#4a4a4a', '#eceff4', '#2c2c2c', '#181818'].map((bg) => [bg, lowContrastRatio(icon, bg)]))
      report.icons.push({ key, contrast, alphaArea: alphaMask(icon, 200).reduce((sum, value) => sum + value, 0) / (icon.width * icon.height) })
      for (const bg of ['#4a4a4a', '#eceff4']) if (contrast[bg].ratio >= 0.4) {
        issue('warnings', 'icon-contrast', key, { background: bg, ratio: contrast[bg].ratio }, '<0.40')
      }
      masks.set(key, alphaMask(await readAvatarPixels(assetPath(root, manifest.assets[key].png), 48)))
      for (const layer of [`${category}/${part.id}`, key]) {
        const pixels = await get(layer), detail = detailDensity(pixels), colors = quantizedColorCount(pixels)
        report.materials.push({ key: layer, rarity: part.rarity, detailDensity: detail.density, colors })
      }
    }
    const pairs = []
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = `icon/${category}/${parts[i].id}`, b = `icon/${category}/${parts[j].id}`
      const iou = silhouetteIou(masks.get(a), masks.get(b))
      pairs.push({ a, b, iou })
      if (iou >= 0.8) issue(iou >= 0.9 ? 'failures' : 'warnings', 'silhouette-pair', `${a} + ${b}`, iou, iou >= 0.9 ? '<0.90' : '<0.80')
    }
    pairs.sort((a, b) => b.iou - a.iou)
    const mean = pairs.length ? pairs.reduce((sum, pair) => sum + pair.iou, 0) / pairs.length : null
    report.silhouettes[category] = { mean, pairs }
    if (category === 'outfit' && mean > 0.55) issue('failures', 'silhouette-outfit-average', category, mean, '<=0.55')
  }
  for (const [key] of Object.entries(manifest.assets)) {
    if (/^(base|crest|wing|headwear|glasses|outfit|prop|icon)\//.test(key)) {
      const pixels = await get(key), row = darkEdgeRowWidth(pixels), distance = outlineDistanceWidth(pixels)
      const range = key.startsWith('icon/') ? [9, 14] : [12, 22]
      // The plan explicitly allows solid square frames up to 24, but does not exempt the other glasses.
      if (key === 'glasses/square' || key === 'glasses/square.small') range[1] = 24
      report.outlines.push({ key, row, distance, range })
      if (distance.median === null || distance.median < range[0] || distance.median > range[1]) {
        issue('failures', 'outline-distance', key, distance, range)
      }
    }
    if (key.startsWith('scene/')) {
      const pixels = await get(key), whole = detailDensity(pixels), center = detailDensity(pixels, manifest.anchors.faceBox)
      const ratio = whole.density > 0 ? center.density / whole.density : center.density === 0 ? 0 : null
      report.scenes.push({ key, centerLuminance: center.meanLuminance, centerDetailRatio: ratio,
        centerDetail: center.density, wholeDetail: whole.density })
      if (center.meanLuminance < 0.16 || center.meanLuminance > 0.78 || ratio > 0.6 || ratio === null) {
        issue('failures', 'scene-center', key, { luminance: center.meanLuminance, ratio }, 'luminance 0.16..0.78; detail ratio <=0.60')
      }
    }
    if (/^fx\/(epic|legendary)(\.back)?$/.test(key)) {
      const measurement = effectCoverage(await get(key), manifest.anchors.faceBox), back = key.endsWith('.back')
      report.effects.push({ key, ...measurement })
      if (back ? measurement.maximumAlpha > 0.5 : measurement.canvasRatio < 0.025 || measurement.canvasRatio > 0.04 || measurement.faceBoxAnyAlphaPixels > 0) {
        issue('failures', 'effect-coverage', key, measurement, back ? 'peak alpha <=0.5' : '2.5..4% coverage at alpha>64, zero faceBox pixels at any alpha')
      }
    }
    if (key.startsWith('face/')) {
      const result = eyebrowPixels(await get(key))
      report.faces.push({ key, ...result })
      if (result.count) issue('failures', 'eyebrow', key, result, 'zero alpha>=64 pixels above y=457')
    }
  }
  for (const rarity of ['epic', 'legendary']) if (!manifest.assets[`fx/${rarity}.back`]) {
    issue('failures', 'missing-backlight', `fx/${rarity}.back`, 'missing', 'required by F4')
  }
  for (const { id } of shared.KUN_AVATAR_CATALOG.headwear) {
    const key = `headwear/${id}`, smallKey = manifest.assets[`${key}.small`] ? `${key}.small` : key
    const measurements = {}
    for (const [candidate, box] of Object.entries(AVATAR_FACEBOX_CANDIDATES)) {
      measurements[candidate] = { full: cropCoverage(await get(key), box), small: cropCoverage(await get(smallKey), box),
        eyePosition: (manifest.anchors.eyeLineY - box[1]) / (box[3] - box[1]) }
    }
    report.hats.push({ key, smallKey, candidates: measurements })
    const activeBox = options.smallFaceBox ?? manifest.anchors.compactFaceBox ?? manifest.anchors.faceBox
    const active = cropCoverage(await get(smallKey), activeBox)
    if (active.ratio < 0.45) issue('failures', 'headwear-crop', smallKey, { ...active, box: activeBox }, '>=0.45')
  }
  report.cropCandidates = Object.fromEntries(Object.entries(AVATAR_FACEBOX_CANDIDATES).map(([name, box]) => [name, {
    box, eyePosition: (manifest.anchors.eyeLineY - box[1]) / (box[3] - box[1]),
    passCount: report.hats.filter((hat) => hat.candidates[name].small.ratio >= 0.45).length,
    missingSmallVariants: report.hats.filter((hat) => hat.candidates[name].small.ratio < 0.45).map((hat) => hat.key)
  }]))
  const activeBox = options.smallFaceBox ?? manifest.anchors.compactFaceBox ?? manifest.anchors.faceBox
  report.activeCrop = { box: activeBox, eyePosition: (manifest.anchors.eyeLineY - activeBox[1]) / (activeBox[3] - activeBox[1]) }
  if (report.activeCrop.eyePosition < 0.45 || report.activeCrop.eyePosition > 0.62) {
    issue('failures', 'crop-eye-position', 'compactFaceBox', report.activeCrop, '0.45..0.62')
  }
  for (const { id } of shared.KUN_AVATAR_CATALOG.color) report.featherColors.push({ key: `base/${id}`, ...featherHue(await get(`base/${id}`)) })
  const sorted = [...report.featherColors].sort((a, b) => a.hue - b.hue)
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i], b = sorted[(i + 1) % sorted.length], spacing = (b.hue - a.hue + 360) % 360
    report.hueSpacing.push({ a: a.key, b: b.key, spacing })
    if (spacing < 15) issue(options.approvedFeatherColors ? 'failures' : 'pending', 'feather-hue-spacing', `${a.key} + ${b.key}`, spacing, '>=15 degrees; awaiting F7 user A/B before activation')
  }
  report.featherMaskAlignment = []
  for (const prefix of ['base/', 'crest/', 'crest/tucked-', 'wing/']) {
    const reference = await get(`${prefix}sky`)
    for (const { id } of shared.KUN_AVATAR_CATALOG.color.filter((color) => color.id !== 'sky')) {
      const variant = await get(`${prefix}${id}`)
      let alphaDifferent = 0, silhouetteDifferent = 0
      for (let i = 3; i < reference.data.length; i += 4) {
        if (reference.data[i] !== variant.data[i]) alphaDifferent++
        if ((reference.data[i] >= 16) !== (variant.data[i] >= 16)) silhouetteDifferent++
      }
      report.featherMaskAlignment.push({ key: `${prefix}${id}`, reference: `${prefix}sky`, alphaDifferent, silhouetteDifferent })
      if (options.approvedFeatherColors && silhouetteDifferent) issue('failures', 'feather-silhouette', `${prefix}${id}`, silhouetteDifferent, 'zero binary-mask differences at alpha>=16')
    }
  }
  const materialGroup = (rarity, icon) => {
    const items = report.materials.filter((item) => item.rarity === rarity && item.key.startsWith('icon/') === icon)
    return { count: items.length,
      detailDensity: items.length ? items.reduce((sum, item) => sum + item.detailDensity, 0) / items.length : null,
      colors: items.length ? items.reduce((sum, item) => sum + item.colors, 0) / items.length : null }
  }
  report.materialGroups = Object.fromEntries(['common', 'rare', 'epic', 'legendary'].map((rarity) => [rarity, materialGroup(rarity, false)]))
  report.iconMaterialGroups = Object.fromEntries(['common', 'rare', 'epic', 'legendary'].map((rarity) => [rarity, materialGroup(rarity, true)]))
  for (const item of report.materials.filter((entry) => ['epic', 'legendary'].includes(entry.rarity))) {
    if (item.detailDensity <= 0.0135 || item.colors <= 81) issue('warnings', 'rarity-material', item.key,
      { detailDensity: item.detailDensity, colors: item.colors }, 'F3: detail>0.0135 and colors>81; does not replace visual material review')
    const reference = item.key.startsWith('icon/') ? report.iconMaterialGroups.rare : report.materialGroups.rare
    if (item.detailDensity <= reference.detailDensity || item.colors <= reference.colors) {
      issue('warnings', 'rarity-material-relative', item.key, { detailDensity: item.detailDensity, colors: item.colors },
        { detailDensityAbove: reference.detailDensity, colorsAbove: reference.colors, reference: 'current rare group, same pixels and algorithm' })
    }
  }
  if (manifest.assets['container/bottle-sealed'] && manifest.assets['container/bottle-glowing']) {
    const sealed = await get('container/bottle-sealed'), glowing = await get('container/bottle-glowing')
    report.bottleDifference = { any: rasterDifference(sealed, glowing, 0), visible: rasterDifference(sealed, glowing, 24) }
    if (report.bottleDifference.visible.ratio < 0.2) issue('warnings', 'bottle-glow-difference', 'container/bottle-glowing',
      report.bottleDifference.visible, '>=0.20; premultiplied RGBA channel difference>24/255')
  }
  images.clear()
  return report
}

async function main() {
  const { loadAvatarCatalog, loadAvatarManifest } = await import('./kun-avatar-compose-check.mjs')
  const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const root = resolve(project, 'src/asset/img/kun-avatar')
  const report = await auditAvatarArt(await loadAvatarManifest(root), await loadAvatarCatalog(), root)
  const output = resolve(process.argv[2] ?? resolve(project, '.cache/kun-avatar-qa/v2-audit.json'))
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ output, failures: report.failures.length, warnings: report.warnings.length,
    cropCandidates: report.cropCandidates, silhouettes: Object.fromEntries(Object.entries(report.silhouettes).map(([key, value]) => [key, { mean: value.mean, pairsOver80: value.pairs.filter((pair) => pair.iou >= 0.8).length }])) }, null, 2))
}

// Let this module finish loading before importing the composition CLI that also imports our audit.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}
