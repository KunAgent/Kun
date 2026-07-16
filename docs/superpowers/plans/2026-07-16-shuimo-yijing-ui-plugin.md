# Shuimo Yijing UI Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bundled ink-wash UI plugin whose light and dark palettes display a stable, launch-time Meihua Yishu hexagram using offline text from Zhu Xi's *Zhouyi Benyi*.

**Architecture:** Keep the plugin manifest declarative and code-free. The Electron main process computes one launch hexagram, enriches only the trusted bundled plugin's IPC load result with a discriminated host effect, and the renderer presents that effect through an inert full-window backdrop. Calendar conversion, hexagram mapping, source import, plugin seeding, IPC enrichment, state, and rendering remain separate testable units.

**Tech Stack:** Electron, React 19, TypeScript 5.8, Zustand, Vitest, Playwright, `lunar-typescript` 1.8.6, `@fontsource/ma-shan-zheng` 5.2.9, Cheerio 1.1.2, MediaWiki Parse API.

---

## File Map

**Create:**

- `src/main/services/shuimo-yijing-hexagram.ts` — pure Meihua calculation, lunar adapter, and King Wen mapping.
- `src/main/services/shuimo-yijing-hexagram.test.ts` — formula, calendar, boundary, and 64-pair coverage.
- `scripts/import-zhouyi-benyi.mjs` — development-only Wikisource importer.
- `src/main/services/data/zhouyi-benyi.json` — generated offline 64-hexagram text dataset.
- `src/main/services/data/zhouyi-benyi.SOURCE.md` — source revisions, attribution, and CC BY-SA terms.
- `src/main/services/zhouyi-benyi.ts` — typed dataset validation and lookup.
- `src/main/services/zhouyi-benyi.test.ts` — dataset completeness and lookup tests.
- `src/main/services/shuimo-yijing-host-effect.ts` — trusted, cached host-effect resolver.
- `src/main/services/shuimo-yijing-host-effect.test.ts` — host-effect and caching tests.
- `src/main/services/bundled-ui-plugin-seeder.ts` — independent per-plugin seed-marker behavior.
- `src/main/services/bundled-ui-plugin-seeder.test.ts` — first seed, retry, legacy marker, and deletion tests.
- `src/renderer/src/components/ShuimoYijingBackdrop.tsx` — inert full-window vertical-calligraphy layer.
- `src/renderer/src/components/ShuimoYijingBackdrop.test.ts` — SSR accessibility and content tests.
- `src/asset/img/shuimo-yijing-kun.png` — transparent ink-wash Kun figure.
- `resources/licenses/ma-shan-zheng-OFL-1.1.txt` — bundled font license.
- `resources/licenses/zhouyi-benyi-CC-BY-SA-4.0.md` — source attribution and license.

**Modify:**

- `package.json`, `package-lock.json` — runtime font/calendar dependencies and development importer dependency.
- `src/shared/ui-plugin.ts`, `src/shared/ui-plugin.test.ts` — host-effect type and manifest security regression.
- `src/shared/kun-gui-api.ts` — optional typed host effect on successful UI-plugin load.
- `src/main/ui-plugin-bundled.ts` — register iKun and Shuimo Yijing through independent seed markers.
- `src/main/ipc/register-app-ipc-handlers.ts` — attach trusted effect after generic figure loading.
- `src/main/ipc/register-app-ipc-handlers.test.ts` — ordinary versus trusted plugin IPC result.
- `src/renderer/src/store/ui-plugin-store.ts` — retain and clear the host effect.
- `src/renderer/src/AppShell.tsx`, `src/renderer/src/AppShell.test.ts` — mount backdrop below application content.
- `src/renderer/src/components/SettingsView.tsx` — identify the settings root for translucent theme tuning.
- `src/renderer/src/main.tsx` — import the bundled calligraphy font.
- `src/renderer/src/styles/base-shell.css` — plugin-specific surface, backdrop, responsive, and reduced-motion styles.
- `docs/UI_PLUGINS.md` — document the bundled trusted-effect boundary.
- `electron-builder.config.cjs` — package third-party license files.

## Task 1: Calendar Adapter and Meihua Hexagram Calculation

**Files:**

- Create: `src/main/services/shuimo-yijing-hexagram.ts`
- Create: `src/main/services/shuimo-yijing-hexagram.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing pure-calculation and calendar tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  calculateMeihuaHexagram,
  lunarInputFromDate,
  kingWenOrdinalFor
} from './shuimo-yijing-hexagram'

describe('calculateMeihuaHexagram', () => {
  it('uses year branch + lunar month + lunar day, then adds the time branch', () => {
    expect(calculateMeihuaHexagram({
      yearBranch: 1,
      lunarMonth: 1,
      lunarDay: 1,
      timeBranch: 1
    })).toEqual({ upperTrigram: 3, lowerTrigram: 4, movingLine: 4, ordinal: 21 })
  })

  it('maps zero remainders to trigram eight and moving line six', () => {
    expect(calculateMeihuaHexagram({
      yearBranch: 12,
      lunarMonth: 8,
      lunarDay: 4,
      timeBranch: 12
    })).toEqual({ upperTrigram: 8, lowerTrigram: 4, movingLine: 6, ordinal: 24 })
  })
})

describe('lunarInputFromDate', () => {
  it('uses the civil lunar date and treats both 23:00 and 00:00 as Zi hour', () => {
    const midnight = lunarInputFromDate(new Date(2026, 1, 17, 0, 0, 0))
    const lateZi = lunarInputFromDate(new Date(2026, 1, 17, 23, 30, 0))
    expect(midnight).toMatchObject({ yearBranch: 7, lunarMonth: 1, lunarDay: 1, timeBranch: 1 })
    expect(lateZi.timeBranch).toBe(1)
    expect(lateZi.lunarDay).toBe(1)
  })
})

it('maps every upper/lower trigram pair to one unique King Wen ordinal', () => {
  const ordinals = new Set<number>()
  for (let upper = 1; upper <= 8; upper += 1) {
    for (let lower = 1; lower <= 8; lower += 1) {
      ordinals.add(kingWenOrdinalFor(upper, lower))
    }
  }
  expect([...ordinals].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 64 }, (_, index) => index + 1)
  )
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/main/services/shuimo-yijing-hexagram.test.ts`

Expected: FAIL because `./shuimo-yijing-hexagram` does not exist.

- [ ] **Step 3: Install exact runtime and importer dependencies**

Run these commands separately:

```bash
npm install lunar-typescript@1.8.6 @fontsource/ma-shan-zheng@5.2.9
npm install --save-dev cheerio@1.1.2
```

Expected: `package.json` contains the two runtime packages under `dependencies`, Cheerio under `devDependencies`, and `package-lock.json` records exact resolved packages.

- [ ] **Step 4: Implement the calculation and complete King Wen pair table**

```ts
import { Lunar } from 'lunar-typescript'

export type MeihuaTimeInput = {
  yearBranch: number
  lunarMonth: number
  lunarDay: number
  timeBranch: number
}

export type MeihuaHexagram = {
  upperTrigram: number
  lowerTrigram: number
  movingLine: number
  ordinal: number
}

const KING_WEN_BY_UPPER_LOWER = [
  [1, 1, 1], [8, 8, 2], [6, 4, 3], [7, 6, 4], [6, 1, 5], [1, 6, 6],
  [8, 6, 7], [6, 8, 8], [5, 1, 9], [1, 2, 10], [8, 1, 11], [1, 8, 12],
  [1, 3, 13], [3, 1, 14], [8, 7, 15], [4, 8, 16], [2, 4, 17], [7, 5, 18],
  [8, 2, 19], [5, 8, 20], [3, 4, 21], [7, 3, 22], [7, 8, 23], [8, 4, 24],
  [1, 4, 25], [7, 1, 26], [7, 4, 27], [2, 5, 28], [6, 6, 29], [3, 3, 30],
  [2, 7, 31], [4, 5, 32], [1, 7, 33], [4, 1, 34], [3, 8, 35], [8, 3, 36],
  [5, 3, 37], [3, 2, 38], [6, 7, 39], [4, 6, 40], [7, 2, 41], [5, 4, 42],
  [2, 1, 43], [1, 5, 44], [2, 8, 45], [8, 5, 46], [2, 6, 47], [6, 5, 48],
  [2, 3, 49], [3, 5, 50], [4, 4, 51], [7, 7, 52], [5, 7, 53], [4, 2, 54],
  [4, 3, 55], [3, 7, 56], [5, 5, 57], [2, 2, 58], [5, 6, 59], [6, 2, 60],
  [5, 2, 61], [4, 7, 62], [6, 3, 63], [3, 6, 64]
] as const

const ordinalByPair = new Map(
  KING_WEN_BY_UPPER_LOWER.map(([upper, lower, ordinal]) => [`${upper}:${lower}`, ordinal])
)

function nonZeroRemainder(value: number, modulus: number): number {
  const remainder = value % modulus
  return remainder === 0 ? modulus : remainder
}

export function kingWenOrdinalFor(upperTrigram: number, lowerTrigram: number): number {
  const ordinal = ordinalByPair.get(`${upperTrigram}:${lowerTrigram}`)
  if (!ordinal) throw new Error(`Unknown trigram pair ${upperTrigram}:${lowerTrigram}`)
  return ordinal
}

export function calculateMeihuaHexagram(input: MeihuaTimeInput): MeihuaHexagram {
  const base = input.yearBranch + Math.abs(input.lunarMonth) + input.lunarDay
  const upperTrigram = nonZeroRemainder(base, 8)
  const lowerTrigram = nonZeroRemainder(base + input.timeBranch, 8)
  const movingLine = nonZeroRemainder(base + input.timeBranch, 6)
  return {
    upperTrigram,
    lowerTrigram,
    movingLine,
    ordinal: kingWenOrdinalFor(upperTrigram, lowerTrigram)
  }
}

export function lunarInputFromDate(date: Date): MeihuaTimeInput {
  const lunar = Lunar.fromDate(date)
  return {
    yearBranch: lunar.getYearZhiIndex() + 1,
    lunarMonth: Math.abs(lunar.getMonth()),
    lunarDay: lunar.getDay(),
    timeBranch: lunar.getTimeZhiIndex() + 1
  }
}

export function calculateStartupHexagram(date: Date): MeihuaHexagram {
  return calculateMeihuaHexagram(lunarInputFromDate(date))
}
```

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/main/services/shuimo-yijing-hexagram.test.ts`

Expected: PASS with four tests and 64 unique ordinals.

- [ ] **Step 6: Commit the calculation slice**

```bash
git add package.json package-lock.json src/main/services/shuimo-yijing-hexagram.ts src/main/services/shuimo-yijing-hexagram.test.ts
git commit -m "feat(ui): calculate launch-time yijing hexagram"
```

## Task 2: Reproducible Offline Zhouyi Benyi Dataset

**Files:**

- Create: `scripts/import-zhouyi-benyi.mjs`
- Create: `src/main/services/data/zhouyi-benyi.json`
- Create: `src/main/services/data/zhouyi-benyi.SOURCE.md`
- Create: `src/main/services/zhouyi-benyi.ts`
- Create: `src/main/services/zhouyi-benyi.test.ts`

- [ ] **Step 1: Write the failing dataset completeness test**

```ts
import { describe, expect, it } from 'vitest'
import { ZHOUYI_BENYI, zhouyiBenyiFor } from './zhouyi-benyi'

describe('ZHOUYI_BENYI', () => {
  it('contains all 64 unique King Wen hexagrams and six lines per hexagram', () => {
    expect(ZHOUYI_BENYI).toHaveLength(64)
    expect(new Set(ZHOUYI_BENYI.map((entry) => entry.ordinal)).size).toBe(64)
    for (const entry of ZHOUYI_BENYI) {
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.statement.length).toBeGreaterThan(0)
      expect(entry.statementCommentary.length).toBeGreaterThan(0)
      expect(entry.lines).toHaveLength(6)
      entry.lines.forEach((line, index) => {
        expect(line.position).toBe(index + 1)
        expect(line.text.length).toBeGreaterThan(0)
        expect(line.commentary.length).toBeGreaterThan(0)
      })
    }
  })

  it('returns Qian and its first line by ordinal and line number', () => {
    const qian = zhouyiBenyiFor(1)
    expect(qian.name).toBe('乾')
    expect(qian.statement).toBe('元亨利貞')
    expect(qian.lines[0]?.text).toBe('潛龍勿用')
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/main/services/zhouyi-benyi.test.ts`

Expected: FAIL because `./zhouyi-benyi` does not exist.

- [ ] **Step 3: Implement the development-only Wikisource importer**

The importer must fetch only these two pages through `action=parse`: `周易本義 (四庫全書本)/卷1` and `/卷2`. It must replace each `<small>` note with a `NOTE` marker, convert `<br>` to newlines, split on Unicode hexagram symbols `U+4DC0..U+4DFF`, and extract the first occurrence of each line label.

```js
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { load } from 'cheerio'

const API = 'https://zh.wikisource.org/w/api.php'
const PAGES = ['周易本義 (四庫全書本)/卷1', '周易本義 (四庫全書本)/卷2']
const NAMES = '乾 坤 屯 蒙 需 訟 師 比 小畜 履 泰 否 同人 大有 謙 豫 隨 蠱 臨 觀 噬嗑 賁 剝 復 无妄 大畜 頤 大過 坎 離 咸 恆 遯 大壯 晉 明夷 家人 睽 蹇 解 損 益 夬 姤 萃 升 困 井 革 鼎 震 艮 漸 歸妹 豐 旅 巽 兌 渙 節 中孚 小過 既濟 未濟'.split(' ')
const linePosition = new Map([
  ['初九', 1], ['初六', 1], ['九二', 2], ['六二', 2], ['九三', 3], ['六三', 3],
  ['九四', 4], ['六四', 4], ['九五', 5], ['六五', 5], ['上九', 6], ['上六', 6]
])

const compact = (value) => value.replace(/[〈〉]/g, '').replace(/\s+/gu, '').trim()

async function fetchPage(page) {
  const url = new URL(API)
  url.search = new URLSearchParams({
    action: 'parse', format: 'json', formatversion: '2', prop: 'text|revid', page
  }).toString()
  const response = await fetch(url, { headers: { 'user-agent': 'Kun-Zhouyi-import/1.0' } })
  if (!response.ok) throw new Error(`${page}: HTTP ${response.status}`)
  const payload = await response.json()
  return { page, revision: payload.parse.revid, html: payload.parse.text }
}

function normalizedPageText(html) {
  const $ = load(html)
  $('style, script').remove()
  $('small').each((_, element) => {
    $(element).replaceWith(`⟦NOTE:${compact($(element).text())}⟧`)
  })
  $('br').replaceWith('\n')
  return $('.poem').text()
}

function parseHexagrams(text) {
  const starts = [...text.matchAll(/[\u4dc0-\u4dff](?=⟦NOTE:)/gu)]
  return starts.map((match, index) => {
    const glyph = match[0]
    const ordinal = glyph.codePointAt(0) - 0x4dbf
    const name = NAMES[ordinal - 1]
    const block = text.slice(match.index, starts[index + 1]?.index ?? text.length)
    const afterHeader = block.replace(/^[\u4dc0-\u4dff]⟦NOTE:[^⟧]*⟧/u, '').trim()
    const statementPair = afterHeader.match(/^(.+?)⟦NOTE:([^⟧]+)⟧/su)
    if (!statementPair || !name) throw new Error(`Cannot parse hexagram ${ordinal}`)
    const statementWithName = compact(statementPair[1])
    const statement = statementWithName.startsWith(name)
      ? statementWithName.slice(name.length)
      : statementWithName
    const lines = []
    const linePattern = /○(初[六九]|[六九][二三四五]|上[六九])([^○⟦\n]+)⟦NOTE:([^⟧]+)⟧/gu
    for (const lineMatch of block.matchAll(linePattern)) {
      const position = linePosition.get(lineMatch[1])
      if (!position || lines.some((line) => line.position === position)) continue
      lines.push({
        position,
        label: lineMatch[1],
        text: compact(lineMatch[2]),
        commentary: compact(lineMatch[3])
      })
    }
    lines.sort((left, right) => left.position - right.position)
    return {
      ordinal,
      glyph,
      name,
      statement,
      statementCommentary: compact(statementPair[2]),
      lines
    }
  })
}

const pages = await Promise.all(PAGES.map(fetchPage))
const entries = pages.flatMap((page) => parseHexagrams(normalizedPageText(page.html)))
entries.sort((left, right) => left.ordinal - right.ordinal)
if (entries.length !== 64 || entries.some((entry) => entry.lines.length !== 6)) {
  throw new Error(`Incomplete import: ${entries.length} hexagrams`)
}
const target = resolve('src/main/services/data/zhouyi-benyi.json')
await writeFile(target, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ target, revisions: pages.map(({ page, revision }) => ({ page, revision })) }))
```

- [ ] **Step 4: Run the importer and record exact source revisions**

Run: `node scripts/import-zhouyi-benyi.mjs`

Expected: the command prints a JSON object containing the output path and two numeric MediaWiki revision IDs, and creates a 64-entry JSON file.

Create `src/main/services/data/zhouyi-benyi.SOURCE.md` with the printed revision IDs, import date `2026-07-16`, author `朱熹`, source URL `https://zh.wikisource.org/wiki/周易本義_(四庫全書本)`, and license URL `https://creativecommons.org/licenses/by-sa/4.0/`.

- [ ] **Step 5: Add typed validation and lookup**

```ts
import rawData from './data/zhouyi-benyi.json'

export type ZhouyiBenyiLine = {
  position: number
  label: string
  text: string
  commentary: string
}

export type ZhouyiBenyiHexagram = {
  ordinal: number
  glyph: string
  name: string
  statement: string
  statementCommentary: string
  lines: ZhouyiBenyiLine[]
}

function assertDataset(value: unknown): asserts value is ZhouyiBenyiHexagram[] {
  if (!Array.isArray(value) || value.length !== 64) throw new Error('Zhouyi Benyi must contain 64 hexagrams')
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid Zhouyi Benyi entry')
    const item = entry as Partial<ZhouyiBenyiHexagram>
    if (!Number.isInteger(item.ordinal) || !item.name || !item.statement ||
        !item.statementCommentary || !Array.isArray(item.lines) || item.lines.length !== 6) {
      throw new Error(`Incomplete Zhouyi Benyi entry ${String(item.ordinal)}`)
    }
  }
}

assertDataset(rawData)
export const ZHOUYI_BENYI: readonly ZhouyiBenyiHexagram[] = rawData
const byOrdinal = new Map(ZHOUYI_BENYI.map((entry) => [entry.ordinal, entry]))

export function zhouyiBenyiFor(ordinal: number): ZhouyiBenyiHexagram {
  const entry = byOrdinal.get(ordinal)
  if (!entry) throw new Error(`Missing Zhouyi Benyi hexagram ${ordinal}`)
  return entry
}
```

- [ ] **Step 6: Run dataset tests and a deterministic regeneration check**

Run these commands:

```bash
npx vitest run src/main/services/zhouyi-benyi.test.ts
Copy-Item src/main/services/data/zhouyi-benyi.json $env:TEMP/zhouyi-benyi-before.json
node scripts/import-zhouyi-benyi.mjs
Compare-Object (Get-Content $env:TEMP/zhouyi-benyi-before.json) (Get-Content src/main/services/data/zhouyi-benyi.json)
```

Expected: tests PASS and `Compare-Object` prints no differences while the source revisions are unchanged.

- [ ] **Step 7: Commit the offline data slice**

```bash
git add scripts/import-zhouyi-benyi.mjs src/main/services/data/zhouyi-benyi.json src/main/services/data/zhouyi-benyi.SOURCE.md src/main/services/zhouyi-benyi.ts src/main/services/zhouyi-benyi.test.ts
git commit -m "feat(ui): bundle zhouyi benyi source data"
```

## Task 3: Typed Trusted Host Effect

**Files:**

- Modify: `src/shared/ui-plugin.ts`
- Modify: `src/shared/ui-plugin.test.ts`
- Modify: `src/shared/kun-gui-api.ts`
- Create: `src/main/services/shuimo-yijing-host-effect.ts`
- Create: `src/main/services/shuimo-yijing-host-effect.test.ts`

- [ ] **Step 1: Write failing host-effect and manifest-boundary tests**

```ts
it('does not copy a hostEffect supplied by a manifest', () => {
  const result = normalizeUiPluginManifest({
    ...validManifest,
    hostEffect: { kind: 'shuimo-yijing' }
  })
  expect(result.ok).toBe(true)
  if (result.ok) expect('hostEffect' in result.manifest).toBe(false)
})
```

```ts
import { describe, expect, it } from 'vitest'
import { createBundledUiPluginHostEffectResolver } from './shuimo-yijing-host-effect'

describe('createBundledUiPluginHostEffectResolver', () => {
  it('returns nothing for ordinary plugin ids', () => {
    const resolve = createBundledUiPluginHostEffectResolver(new Date(2026, 1, 17, 0, 0, 0))
    expect(resolve('starlight')).toBeUndefined()
  })

  it('returns one stable trusted effect for the bundled id', () => {
    const resolve = createBundledUiPluginHostEffectResolver(new Date(2026, 1, 17, 0, 0, 0))
    const first = resolve('shuimo-yijing')
    const second = resolve('shuimo-yijing')
    expect(first).toBe(second)
    expect(first).toMatchObject({ kind: 'shuimo-yijing', hexagram: { movingLine: 4 } })
  })
})
```

- [ ] **Step 2: Run the tests and verify missing exports**

Run: `npx vitest run src/shared/ui-plugin.test.ts src/main/services/shuimo-yijing-host-effect.test.ts`

Expected: FAIL because the host-effect resolver and shared type do not exist.

- [ ] **Step 3: Add the discriminated read-only shared contract**

```ts
export const UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID = 'shuimo-yijing'

export type UiPluginHostEffect = Readonly<{
  kind: 'shuimo-yijing'
  hexagram: Readonly<{
    ordinal: number
    glyph: string
    name: string
    statement: string
    statementCommentary: string
    movingLine: number
    movingLineLabel: string
    movingLineText: string
    movingLineCommentary: string
  }>
}>
```

Import `UiPluginHostEffect` into `src/shared/kun-gui-api.ts` and change only the successful IPC result:

```ts
export type UiPluginLoadIpcResult =
  | {
      ok: true
      manifest: UiPluginManifestV1
      figures: UiPluginRuntimeFigures
      hostEffect?: UiPluginHostEffect
    }
  | { ok: false; error: string }
```

- [ ] **Step 4: Implement a launch-time resolver with closure caching**

```ts
import {
  UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID,
  type UiPluginHostEffect
} from '../../shared/ui-plugin'
import { calculateStartupHexagram } from './shuimo-yijing-hexagram'
import { zhouyiBenyiFor } from './zhouyi-benyi'

export function createBundledUiPluginHostEffectResolver(startedAt: Date) {
  let cached: UiPluginHostEffect | undefined
  return (pluginId: string): UiPluginHostEffect | undefined => {
    if (pluginId !== UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID) return undefined
    if (cached) return cached
    const calculated = calculateStartupHexagram(startedAt)
    const source = zhouyiBenyiFor(calculated.ordinal)
    const line = source.lines[calculated.movingLine - 1]
    if (!line) throw new Error(`Missing moving line ${calculated.movingLine}`)
    cached = Object.freeze({
      kind: 'shuimo-yijing' as const,
      hexagram: Object.freeze({
        ordinal: source.ordinal,
        glyph: source.glyph,
        name: source.name,
        statement: source.statement,
        statementCommentary: source.statementCommentary,
        movingLine: calculated.movingLine,
        movingLineLabel: line.label,
        movingLineText: line.text,
        movingLineCommentary: line.commentary
      })
    })
    return cached
  }
}

export const resolveBundledUiPluginHostEffect =
  createBundledUiPluginHostEffectResolver(new Date())
```

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/shared/ui-plugin.test.ts src/main/services/shuimo-yijing-host-effect.test.ts`

Expected: PASS; the manifest never gains a `hostEffect`, ordinary ids return `undefined`, and repeated trusted loads return the same object.

- [ ] **Step 6: Commit the shared contract slice**

```bash
git add src/shared/ui-plugin.ts src/shared/ui-plugin.test.ts src/shared/kun-gui-api.ts src/main/services/shuimo-yijing-host-effect.ts src/main/services/shuimo-yijing-host-effect.test.ts
git commit -m "feat(ui): define trusted yijing host effect"
```

## Task 4: Independent Bundled Plugin Seeding and Ink Figure

**Files:**

- Create: `src/main/services/bundled-ui-plugin-seeder.ts`
- Create: `src/main/services/bundled-ui-plugin-seeder.test.ts`
- Create: `src/asset/img/shuimo-yijing-kun.png`
- Modify: `src/main/ui-plugin-bundled.ts`

- [ ] **Step 1: Write failing marker lifecycle tests**

Test `seedBundledUiPluginOnce` with a temporary Kun home and an injected `seed` function. Cover: first call seeds and writes a marker; second call skips; a thrown seed writes no marker and retries; an existing marker with a deleted plugin directory still skips; iKun accepts `.bundled-seed-v1` as a legacy marker alias.

```ts
const result = await seedBundledUiPluginOnce({
  kunHomeDir,
  pluginId: 'shuimo-yijing',
  markerVersion: 1,
  seed
})
expect(result).toBe('seeded')
expect(seed).toHaveBeenCalledTimes(1)
await rm(join(uiPluginsRootDir(kunHomeDir), 'shuimo-yijing'), { recursive: true, force: true })
expect(await seedBundledUiPluginOnce({
  kunHomeDir,
  pluginId: 'shuimo-yijing',
  markerVersion: 1,
  seed
})).toBe('skipped')
```

- [ ] **Step 2: Run the test and verify the missing helper failure**

Run: `npx vitest run src/main/services/bundled-ui-plugin-seeder.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement independent marker behavior**

```ts
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { uiPluginsRootDir } from './ui-plugin-service'

type SeedInput = {
  kunHomeDir: string
  pluginId: string
  markerVersion: number
  legacyMarkers?: string[]
  seed: () => Promise<{ ok: true } | { ok: false; errors: string[] }>
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

export async function seedBundledUiPluginOnce(
  input: SeedInput
): Promise<'seeded' | 'skipped'> {
  const root = uiPluginsRootDir(input.kunHomeDir)
  const marker = join(root, `.bundled-${input.pluginId}-v${input.markerVersion}`)
  const candidates = [marker, ...(input.legacyMarkers ?? []).map((name) => join(root, name))]
  if ((await Promise.all(candidates.map(exists))).some(Boolean)) return 'skipped'
  const result = await input.seed()
  if (!result.ok) throw new Error(result.errors.join('; '))
  await mkdir(root, { recursive: true })
  await writeFile(marker, `${input.pluginId}\n`, 'utf8')
  return 'seeded'
}
```

- [ ] **Step 4: Generate the single reusable ink-wash Kun asset**

Use the `imagegen` skill with this prompt and save the transparent PNG at exactly `src/asset/img/shuimo-yijing-kun.png`:

```text
A small friendly Kun bird mascot in traditional Chinese shuimo ink-wash painting,
body facing left, calm seated/swimming pose, sparse expressive black and gray brush
strokes, one restrained cinnabar-red seal-like accent, transparent background,
no text, no frame, no scenery, readable at 64 px, longest edge 512 px.
```

Verify the image has an alpha channel, longest edge at most 512 px, and file size below 2 MB.

- [ ] **Step 5: Register the bundled manifest and palette**

Use the one image for `swim`, `greet`, and `toggleIcon`. Set `features.cameos` to `false`. The manifest must contain exactly these 30 entries per palette, reaching but not exceeding the existing 60-entry total limit:

```ts
const SHUIMO_LIGHT_TOKENS = {
  '--ds-bg-main': '#f2f0e7',
  '--ds-bg-sidebar': '#e8e9e2',
  '--ds-bg-canvas': '#f7f5ee',
  '--ds-surface-card': 'rgba(248, 247, 240, 0.92)',
  '--ds-surface-elevated': 'rgba(252, 250, 244, 0.97)',
  '--ds-surface-subtle': '#e7e8e0',
  '--ds-surface-hover': 'rgba(67, 83, 75, 0.08)',
  '--ds-border': 'rgba(54, 68, 62, 0.16)',
  '--ds-border-muted': 'rgba(54, 68, 62, 0.1)',
  '--ds-border-strong': 'rgba(54, 68, 62, 0.24)',
  '--ds-text': '#27302c',
  '--ds-text-muted': '#59645e',
  '--ds-text-faint': '#7e8983',
  '--ds-accent': '#8f4036',
  '--ds-accent-soft': 'rgba(143, 64, 54, 0.14)',
  '--ds-success': '#2f7d54',
  '--ds-danger': '#a4473d',
  '--ds-diff-added': '#2f7d54',
  '--ds-diff-added-soft': 'rgba(47, 125, 84, 0.11)',
  '--ds-diff-removed': '#a4473d',
  '--ds-diff-removed-soft': 'rgba(164, 71, 61, 0.11)',
  '--ds-skill': '#6b5c8f',
  '--ds-skill-soft': 'rgba(107, 92, 143, 0.12)',
  '--ds-success-soft': 'rgba(47, 125, 84, 0.12)',
  '--ds-warning-soft': 'rgba(165, 118, 45, 0.14)',
  '--ds-danger-soft': 'rgba(164, 71, 61, 0.12)',
  '--ds-selection': 'rgba(78, 99, 88, 0.18)',
  '--ds-bubble-user': 'rgba(76, 96, 85, 0.11)',
  '--ds-bubble-user-fg': '#27302c',
  '--ds-code-block-bg': '#e5e7df'
}

const SHUIMO_DARK_TOKENS = {
  '--ds-bg-main': '#171c1a',
  '--ds-bg-sidebar': '#121614',
  '--ds-bg-canvas': '#1c221f',
  '--ds-surface-card': 'rgba(31, 38, 34, 0.94)',
  '--ds-surface-elevated': 'rgba(37, 44, 40, 0.98)',
  '--ds-surface-subtle': '#242b27',
  '--ds-surface-hover': 'rgba(218, 223, 214, 0.08)',
  '--ds-border': 'rgba(218, 223, 214, 0.14)',
  '--ds-border-muted': 'rgba(218, 223, 214, 0.09)',
  '--ds-border-strong': 'rgba(218, 223, 214, 0.22)',
  '--ds-text': '#e4e2d9',
  '--ds-text-muted': '#adb5ae',
  '--ds-text-faint': '#818c85',
  '--ds-accent': '#c46b5e',
  '--ds-accent-soft': 'rgba(196, 107, 94, 0.16)',
  '--ds-success': '#72b18c',
  '--ds-danger': '#d47c70',
  '--ds-diff-added': '#72b18c',
  '--ds-diff-added-soft': 'rgba(114, 177, 140, 0.14)',
  '--ds-diff-removed': '#d47c70',
  '--ds-diff-removed-soft': 'rgba(212, 124, 112, 0.14)',
  '--ds-skill': '#a89bc1',
  '--ds-skill-soft': 'rgba(168, 155, 193, 0.14)',
  '--ds-success-soft': 'rgba(114, 177, 140, 0.14)',
  '--ds-warning-soft': 'rgba(202, 157, 86, 0.15)',
  '--ds-danger-soft': 'rgba(212, 124, 112, 0.14)',
  '--ds-selection': 'rgba(190, 201, 192, 0.16)',
  '--ds-bubble-user': 'rgba(190, 201, 192, 0.1)',
  '--ds-bubble-user-fg': '#e4e2d9',
  '--ds-code-block-bg': '#111614'
}
```

Refactor `ensureBundledUiPlugins` to call `seedBundledUiPluginOnce` once for iKun with legacy marker `.bundled-seed-v1`, and once for `shuimo-yijing` without a legacy marker. Keep per-plugin in-process promises so concurrent list/load IPC calls do not double-seed.

- [ ] **Step 6: Run seeding and generic plugin tests**

Run: `npx vitest run src/main/services/bundled-ui-plugin-seeder.test.ts src/main/services/ui-plugin-service.test.ts src/shared/ui-plugin.test.ts`

Expected: PASS; generated manifest normalizes through the same v1 schema as third-party plugins.

- [ ] **Step 7: Commit the bundled plugin slice**

```bash
git add src/main/services/bundled-ui-plugin-seeder.ts src/main/services/bundled-ui-plugin-seeder.test.ts src/main/ui-plugin-bundled.ts src/asset/img/shuimo-yijing-kun.png
git commit -m "feat(ui): bundle shuimo yijing plugin"
```

## Task 5: IPC Enrichment and Renderer State Lifecycle

**Files:**

- Modify: `src/main/ipc/register-app-ipc-handlers.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.test.ts`
- Modify: `src/renderer/src/store/ui-plugin-store.ts`

- [ ] **Step 1: Write failing IPC enrichment tests**

Mock `loadUiPluginFigures` and `resolveBundledUiPluginHostEffect`. Assert `ui-plugin:load` returns no `hostEffect` for `starlight`, returns the effect for `shuimo-yijing`, and returns the generic load failure unchanged.

```ts
expect(await handler({}, { id: 'starlight' })).toEqual({
  ok: true,
  manifest: expect.objectContaining({ id: 'starlight' }),
  figures: {}
})
expect(await handler({}, { id: 'shuimo-yijing' })).toMatchObject({
  ok: true,
  hostEffect: { kind: 'shuimo-yijing' }
})
```

- [ ] **Step 2: Run the IPC test and verify the missing effect**

Run: `npx vitest run src/main/ipc/register-app-ipc-handlers.test.ts`

Expected: FAIL because the handler returns only generic figures and manifest.

- [ ] **Step 3: Enrich only a successful trusted load**

```ts
const loaded = await loadUiPluginFigures(kunHomeDir, request.id)
if (!loaded.ok) return loaded
try {
  const hostEffect = resolveBundledUiPluginHostEffect(request.id)
  return { ...loaded, ...(hostEffect ? { hostEffect } : {}) }
} catch (error) {
  console.warn('[ui-plugin] shuimo yijing host effect unavailable:',
    error instanceof Error ? error.message : String(error))
  return loaded
}
```

The warning must not include the launch timestamp or user paths.

- [ ] **Step 4: Retain and clear the effect in Zustand**

Extend `UiPluginRuntime` with `hostEffect?: UiPluginHostEffect`. When activation succeeds, copy `result.hostEffect`; when default, Retroma, error, removal, or a different plugin activates, replace `activeRuntime` so the old effect cannot remain.

```ts
const runtime: UiPluginRuntime = {
  manifest: result.manifest,
  figures: result.figures,
  ...(result.hostEffect ? { hostEffect: result.hostEffect } : {})
}
```

- [ ] **Step 5: Run IPC and type checks**

Run:

```bash
npx vitest run src/main/ipc/register-app-ipc-handlers.test.ts
npm run typecheck
```

Expected: PASS with no preload changes required because `loadUiPlugin` already forwards the typed IPC result.

- [ ] **Step 6: Commit IPC and state changes**

```bash
git add src/main/ipc/register-app-ipc-handlers.ts src/main/ipc/register-app-ipc-handlers.test.ts src/renderer/src/store/ui-plugin-store.ts
git commit -m "feat(ui): deliver yijing host effect to renderer"
```

## Task 6: Full-Window Calligraphy Backdrop and Theme Surfaces

**Files:**

- Create: `src/renderer/src/components/ShuimoYijingBackdrop.tsx`
- Create: `src/renderer/src/components/ShuimoYijingBackdrop.test.ts`
- Modify: `src/renderer/src/AppShell.tsx`
- Modify: `src/renderer/src/AppShell.test.ts`
- Modify: `src/renderer/src/components/SettingsView.tsx`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles/base-shell.css`

- [ ] **Step 1: Write failing SSR tests for the inert backdrop**

```ts
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShuimoYijingBackdrop } from './ShuimoYijingBackdrop'

const effect = {
  kind: 'shuimo-yijing' as const,
  hexagram: {
    ordinal: 1, glyph: '䷀', name: '乾', statement: '元亨利貞',
    statementCommentary: '六畫者伏羲所畫之卦也', movingLine: 1,
    movingLineLabel: '初九', movingLineText: '潛龍勿用',
    movingLineCommentary: '初陽在下未可施用'
  }
}

it('renders all approved text as inert plain content', () => {
  const html = renderToStaticMarkup(createElement(ShuimoYijingBackdrop, { effect }))
  expect(html).toContain('aria-hidden="true"')
  expect(html).toContain('pointer-events-none')
  expect(html).toContain('乾')
  expect(html).toContain('元亨利貞')
  expect(html).toContain('初九')
  expect(html).toContain('潛龍勿用')
  expect(html).not.toContain('dangerouslySetInnerHTML')
})

it('renders nothing without the trusted effect', () => {
  expect(renderToStaticMarkup(createElement(ShuimoYijingBackdrop, { effect: undefined }))).toBe('')
})
```

- [ ] **Step 2: Run the test and verify the missing component**

Run: `npx vitest run src/renderer/src/components/ShuimoYijingBackdrop.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the presentational and connected components**

```tsx
import type { UiPluginHostEffect } from '@shared/ui-plugin'
import { useUiPluginStore } from '../store/ui-plugin-store'

export function ShuimoYijingBackdrop({
  effect
}: {
  effect?: UiPluginHostEffect
}): React.ReactElement | null {
  if (!effect || effect.kind !== 'shuimo-yijing') return null
  const hexagram = effect.hexagram
  return (
    <div aria-hidden="true" className="shuimo-yijing-backdrop pointer-events-none absolute inset-0 z-0 select-none overflow-hidden">
      <div className="shuimo-yijing-script">
        <p className="shuimo-yijing-title">{hexagram.glyph}{hexagram.name}</p>
        <p>{hexagram.statement}</p>
        <p>{hexagram.statementCommentary}</p>
        <p>{hexagram.movingLineLabel}{hexagram.movingLineText}</p>
        <p>{hexagram.movingLineCommentary}</p>
      </div>
    </div>
  )
}

export function ActiveShuimoYijingBackdrop(): React.ReactElement | null {
  const effect = useUiPluginStore((state) => state.activeRuntime?.hostEffect)
  return <ShuimoYijingBackdrop effect={effect} />
}
```

- [ ] **Step 4: Mount the layer once at AppShell and identify root surfaces**

Add `relative isolate` and `ds-app-shell` to the outer `AppShell` frame, render `ActiveShuimoYijingBackdrop` as its first child, and give the existing titlebar/content/dialog chain `relative z-10`. Add `ds-settings-shell` to the root element at `SettingsView.tsx:1187`; `Workbench` already has `ds-workbench-shell`.

Import the font immediately after third-party component CSS in `main.tsx`:

```ts
import '@fontsource/ma-shan-zheng/400.css'
```

Extend `AppShell.test.ts` with a fixed host effect. Before rendering, call `useUiPluginStore.setState({ uiMode: 'shuimo-yijing', activeRuntime: { manifest: { id: 'shuimo-yijing', name: '水墨易经', version: '1.0.0', figures: { swim: 'img/ink.png' } }, figures: {}, hostEffect: effect } })`; restore `uiMode: 'default'` and `activeRuntime: null` in `afterEach`. Assert `shuimo-yijing-backdrop`, `relative isolate`, and the foreground `z-10` wrapper are present in SSR markup.

- [ ] **Step 5: Add plugin-scoped layout, ink, and surface CSS**

```css
html[data-ui-plugin='shuimo-yijing'] .ds-app-shell,
html[data-ui-plugin='shuimo-yijing'] .ds-workbench-shell,
html[data-ui-plugin='shuimo-yijing'] .ds-settings-shell {
  background-color: color-mix(in srgb, var(--ds-bg-main) 92%, transparent);
}

html[data-ui-plugin='shuimo-yijing'] {
  --ds-stage-gradient: linear-gradient(180deg, rgba(247, 245, 238, 0.94), rgba(232, 233, 226, 0.92));
  --ds-topbar-bg: linear-gradient(180deg, rgba(248, 247, 240, 0.96), rgba(242, 240, 231, 0.9));
  --ds-sidebar-gradient: linear-gradient(180deg, rgba(236, 237, 230, 0.96), rgba(229, 231, 223, 0.94));
  --ds-sidebar-haze: linear-gradient(180deg, rgba(255, 255, 255, 0.22), transparent 34%);
  --ds-sidebar-border: rgba(54, 68, 62, 0.16);
  --ds-sidebar-row-hover: rgba(67, 83, 75, 0.08);
  --ds-sidebar-row-active: rgba(67, 83, 75, 0.13);
  --ds-card-soft: rgba(248, 247, 240, 0.9);
  --ds-card-strong: rgba(252, 250, 244, 0.97);
  --ds-card-muted: rgba(235, 235, 227, 0.9);
  --ds-card-hover: rgba(252, 250, 244, 0.98);
  --ds-chip-bg: rgba(248, 247, 240, 0.92);
  --ds-chip-muted-bg: rgba(235, 235, 227, 0.9);
  --ds-chip-hover: rgba(252, 250, 244, 0.98);
  --ds-chip-border: rgba(54, 68, 62, 0.15);
  --ds-code-bg: rgba(231, 232, 224, 0.95);
  --ds-inline-code-bg: rgba(225, 228, 219, 0.92);
  --ds-pre-bg: rgba(235, 235, 227, 0.96);
  --ds-table-head-bg: rgba(230, 232, 223, 0.96);
  --ds-scrollbar-thumb: rgba(70, 82, 76, 0.25);
  --ds-scrollbar-thumb-hover: rgba(70, 82, 76, 0.36);
}

[data-theme='dark'][data-ui-plugin='shuimo-yijing'] {
  --ds-stage-gradient: linear-gradient(180deg, rgba(31, 38, 34, 0.95), rgba(20, 25, 22, 0.94));
  --ds-topbar-bg: linear-gradient(180deg, rgba(35, 42, 38, 0.96), rgba(24, 30, 27, 0.9));
  --ds-sidebar-gradient: linear-gradient(180deg, rgba(25, 31, 28, 0.96), rgba(17, 22, 19, 0.95));
  --ds-sidebar-haze: linear-gradient(180deg, rgba(228, 226, 217, 0.045), transparent 34%);
  --ds-sidebar-border: rgba(218, 223, 214, 0.13);
  --ds-sidebar-row-hover: rgba(218, 223, 214, 0.07);
  --ds-sidebar-row-active: rgba(218, 223, 214, 0.11);
  --ds-card-soft: rgba(31, 38, 34, 0.92);
  --ds-card-strong: rgba(37, 44, 40, 0.98);
  --ds-card-muted: rgba(34, 41, 37, 0.9);
  --ds-card-hover: rgba(43, 51, 46, 0.98);
  --ds-chip-bg: rgba(31, 38, 34, 0.94);
  --ds-chip-muted-bg: rgba(34, 41, 37, 0.92);
  --ds-chip-hover: rgba(43, 51, 46, 0.98);
  --ds-chip-border: rgba(218, 223, 214, 0.13);
  --ds-code-bg: rgba(30, 37, 33, 0.96);
  --ds-inline-code-bg: rgba(218, 223, 214, 0.075);
  --ds-pre-bg: rgba(20, 26, 23, 0.98);
  --ds-table-head-bg: rgba(34, 41, 37, 0.96);
  --ds-scrollbar-thumb: rgba(190, 201, 192, 0.24);
  --ds-scrollbar-thumb-hover: rgba(190, 201, 192, 0.36);
}

.shuimo-yijing-backdrop {
  color: rgba(39, 48, 44, 0.065);
  background:
    linear-gradient(180deg, rgba(247, 245, 238, 0.68), rgba(232, 233, 226, 0.46)),
    var(--ds-bg-main);
  opacity: 0;
  animation: shuimo-yijing-reveal 180ms ease-out forwards;
}

[data-theme='dark'] .shuimo-yijing-backdrop {
  color: rgba(228, 226, 217, 0.05);
  background:
    linear-gradient(180deg, rgba(28, 34, 31, 0.72), rgba(18, 22, 20, 0.62)),
    var(--ds-bg-main);
}

.shuimo-yijing-script {
  position: absolute;
  inset: 4.5rem 2.5rem 2.5rem;
  display: flex;
  flex-direction: row-reverse;
  justify-content: space-around;
  gap: clamp(2rem, 5vw, 6rem);
  overflow: hidden;
  font-family: 'Ma Shan Zheng', 'STXingkai', 'KaiTi', serif;
  font-size: 1.55rem;
  line-height: 1.85;
  letter-spacing: 0;
  writing-mode: vertical-rl;
  text-orientation: upright;
}

.shuimo-yijing-script p { margin: 0; max-height: 100%; }
.shuimo-yijing-title { font-size: 2.15rem; }

@keyframes shuimo-yijing-reveal { to { opacity: 1; } }

@media (max-width: 900px) {
  .shuimo-yijing-script { inset-inline: 1.25rem; gap: 2.25rem; }
  .shuimo-yijing-script p:nth-child(3) { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .shuimo-yijing-backdrop { animation: none; opacity: 1; }
}
```

Do not alter global card radii or typography. Keep editors, code blocks, dialogs, and composer surfaces at their existing opaque token values; only the three root surfaces above become translucent.

- [ ] **Step 6: Run component, AppShell, CSS regression, and type tests**

Run:

```bash
npx vitest run src/renderer/src/components/ShuimoYijingBackdrop.test.ts src/renderer/src/AppShell.test.ts src/renderer/src/components/chat/AnimatedWorkLogo.test.ts
npm run typecheck
```

Expected: PASS; background markup is inert and existing iKun/Retroma selectors remain present.

- [ ] **Step 7: Commit the renderer slice**

```bash
git add src/renderer/src/components/ShuimoYijingBackdrop.tsx src/renderer/src/components/ShuimoYijingBackdrop.test.ts src/renderer/src/AppShell.tsx src/renderer/src/AppShell.test.ts src/renderer/src/components/SettingsView.tsx src/renderer/src/main.tsx src/renderer/src/styles/base-shell.css
git commit -m "feat(ui): render full-window yijing backdrop"
```

## Task 7: Attribution, Plugin Documentation, and Packaging

**Files:**

- Create: `resources/licenses/ma-shan-zheng-OFL-1.1.txt`
- Create: `resources/licenses/zhouyi-benyi-CC-BY-SA-4.0.md`
- Modify: `docs/UI_PLUGINS.md`
- Modify: `electron-builder.config.cjs`

- [ ] **Step 1: Add exact attribution files**

Copy the OFL 1.1 text distributed by `@fontsource/ma-shan-zheng` into `resources/licenses/ma-shan-zheng-OFL-1.1.txt`. In `zhouyi-benyi-CC-BY-SA-4.0.md`, record Zhu Xi as author, the two exact Wikisource page URLs and revision IDs from Task 2, the import date, a description of normalization, and the CC BY-SA 4.0 URL.

- [ ] **Step 2: Document the trusted-effect boundary**

Add a section to `docs/UI_PLUGINS.md` stating:

```markdown
## 预装插件的宿主特效

`ikun` 和 `shuimo-yijing` 可由 Kun 宿主针对固定插件 id 提供内置动画或动态背景。
这些效果属于随应用编译、审查和测试的可信代码，不来自插件目录，也不是
`manifest.json` 能申请的能力。第三方插件仍只能声明图片、文案、主题 token 和
`features.cameos`；安装器不会复制或执行脚本、HTML、CSS、字体或动态背景配置。
```

- [ ] **Step 3: Package the license directory**

Add one `extraResources` entry without changing the existing Whisper entry:

```js
{
  from: 'resources/licenses',
  to: 'licenses',
  filter: ['**/*']
}
```

- [ ] **Step 4: Verify docs and packaging config**

Run:

```bash
git diff --check -- docs/UI_PLUGINS.md resources/licenses electron-builder.config.cjs
node -e "const c=require('./electron-builder.config.cjs'); if(!c.extraResources.some(x=>x.to==='licenses')) process.exit(1)"
```

Expected: no whitespace errors and exit code 0.

- [ ] **Step 5: Commit documentation and licenses**

```bash
git add docs/UI_PLUGINS.md resources/licenses electron-builder.config.cjs
git commit -m "docs(ui): attribute yijing theme resources"
```

## Task 8: Integrated Verification and Visual QA

**Files:**

- Modify only files required to fix failures introduced by Tasks 1–7.
- Do not commit `.superpowers/brainstorm`, screenshots, logs, `dist`, or extracted applications.

- [ ] **Step 1: Run the focused suite**

```bash
npx vitest run src/main/services/shuimo-yijing-hexagram.test.ts src/main/services/zhouyi-benyi.test.ts src/main/services/shuimo-yijing-host-effect.test.ts src/main/services/bundled-ui-plugin-seeder.test.ts src/main/services/ui-plugin-service.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/shared/ui-plugin.test.ts src/renderer/src/components/ShuimoYijingBackdrop.test.ts src/renderer/src/AppShell.test.ts src/renderer/src/components/chat/AnimatedWorkLogo.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run repository checks**

```bash
npm run typecheck
npm run test
npm run build:kun
npm run build
npm run lint
```

Expected: all commands exit 0. If a command has a pre-existing baseline failure, save the exact failure output, prove the same failure exists without this feature's files, and report it rather than treating it as passing.

- [ ] **Step 3: Start the Electron development app**

Run: `npm run dev`

Expected: Electron opens, Vite serves the renderer at `http://127.0.0.1:5179`, Kun runtime reaches its normal healthy state, and the Shape Workshop lists `水墨易经` alongside existing plugins.

- [ ] **Step 4: Perform light and dark visual checks**

Activate `水墨易经`. Capture Playwright screenshots at `1440x900`, `1024x768`, and `800x600` for Code, Design, Write, and Settings in both light and dark modes. Verify with screenshot inspection and pixel sampling:

- The backdrop is nonblank and uses the same hexagram before and after theme switches.
- Calligraphy is visible at low contrast without crossing above dialogs, inputs, code, or editor content.
- Sidebar, titlebar, cards, composer, code blocks, tooltips, and long labels remain readable.
- At `800x600`, the commentary column is hidden and no text overlaps.
- Reduced-motion emulation removes the fade while leaving the backdrop visible.
- Disabling or deleting the plugin removes both ink text and plugin token styling.

- [ ] **Step 5: Review the final diff and dependency security**

```bash
npm audit
git diff --check
git status --short
git diff --stat b8ca0635..HEAD
git diff b8ca0635..HEAD -- src/shared src/main src/renderer docs/UI_PLUGINS.md electron-builder.config.cjs package.json
```

Expected: no secrets, build artifacts, visual-companion files, unrelated reformatting, or plugin security regressions. Review all audit findings and distinguish newly introduced dependency findings from the existing lockfile baseline.

- [ ] **Step 6: Commit only verification fixes if needed**

If verification required code changes, stage only those files and commit:

```bash
git commit -m "fix(ui): polish shuimo yijing theme"
```

If no fixes were required, do not create an empty commit.
