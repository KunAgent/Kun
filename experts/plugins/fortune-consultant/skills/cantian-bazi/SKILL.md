---
name: cantian-bazi
description: 以命理场景为主的八字排盘、黄历查询与大运/流年/流月/流日/流时区间查询技能。用于用户请求“算八字”“四柱排盘”“阳历/农历转八字”“查黄历/宜忌”“查未来10年流年”“查下个月流日/流时”等场景；关键词包括：八字、四柱、命理、大运、流年、流月、流日、流时、时辰、阳历转八字、农历转八字、黄历、宜忌、干支日期。真太阳时换算属于辅助能力，仅在需要校时定盘时使用。 / Bazi-first skill for charting, Chinese almanac lookup, and range queries of decade/annual/monthly/daily/hourly luck cycles. Use for requests like “calculate my Bazi”, “convert solar/lunar datetime to Bazi”, “check huangli”, “query next 10 years”, and “check next month daily/hourly cycles”. Keywords focus on Bazi/Four Pillars and fortune-cycle analysis; true-solar-time conversion is an auxiliary step only when time correction is required.
---

# 八字排盘、黄历与大运流年查询 (Bazi, Calendar & Fortune Range)

## 何时使用 / When to Use

- 用户要根据阳历出生时间计算四柱八字。 / User wants Four Pillars from Gregorian birth datetime.
- 用户要根据农历出生时间计算四柱八字。 / User wants Four Pillars from lunar birth datetime.
- 用户要查询某一天对应的农历、干支、宜忌等信息。 / User wants Chinese calendar info for a specific date.
- 用户要“查黄历”或看某天宜忌。 / User wants almanac-style daily auspicious/inauspicious info.
- 用户要查询一段时间内的大运、流年、流月、流日或流时。 / User wants decade/annual/monthly/daily/hourly fortune cycles in a time range.

## 前置依赖 / Prerequisites

- 推荐运行环境：Node 24（可直接运行 TypeScript 源码）。 / Recommended runtime: Node 24 (can run TypeScript source directly).
- 兼容方案：若 Node 版本较低，使用 `tsx` 执行。 / Fallback: use `tsx` on lower Node versions.
- 执行目录：在 skill 根目录（`SKILL.md` 所在目录）执行以下命令。 / Run commands in the skill root (where `SKILL.md` is located).

```bash
npm i

# 仅在需要兼容运行时安装
# Install only for fallback mode
npm i -D tsx
```

## 脚本清单 / Script Index

- `scripts/buildBaziFromSolar.ts`：根据阳历时间生成八字 Markdown。 / Build Bazi from solar datetime.
- `scripts/buildBaziFromLunar.ts`：根据农历时间生成八字 Markdown。 / Build Bazi from lunar datetime.
- `scripts/convertToTrueSolarTime.ts`：将北京时间按经度换算为真太阳时（输出可直接给其它脚本使用）。 / Convert Beijing time to true solar time by longitude.
- `scripts/getChineseCalendar.ts`：查询指定日期（默认今天）的农历与干支信息。 / Get Chinese calendar for a given date (defaults to today).
- `scripts/queryFortuneRange.ts`：按时间区间查询大运与流年/流月/流日/流时（流时按时辰段合并）。 / Query decade fortune and annual/monthly/daily/hourly cycles in a time range.

## 脚本与参数 / Scripts & Parameters

### `scripts/buildBaziFromSolar.ts`

```bash
# 推荐方式
node scripts/buildBaziFromSolar.ts <solarTime> [gender] [sect]

# 兼容方式（fallback）
tsx scripts/buildBaziFromSolar.ts <solarTime> [gender] [sect]
```

参数定义 / Parameters:

- `solarTime`（必填 / required）
  - 格式：ISO 8601 日期时间（不带时区），如 `1990-05-15T14:30:00`
  - 默认值：无
  - 非法输入：格式不合法或为空时，由底层解析失败并报错
- `gender`（可选 / optional）
  - 取值范围：`1`（男 / male）、`0`（女 / female）
  - 默认值：`1`
  - 非法输入：抛错 `性别参数无效。男性传 1，女性传 0。`
- `sect`（可选 / optional）
  - 取值范围：`1`（23:00-23:59 视为明天）、`2`（23:00-23:59 视为当天）
  - 默认值：`2`
  - 非法输入：抛错 `早晚子时配置参数无效。传 1 表示 23:00-23:59 日干支为明天，传 2 表示 23:00-23:59 日干支为当天。`

### `scripts/buildBaziFromLunar.ts`

```bash
# 推荐方式
node scripts/buildBaziFromLunar.ts <lunarTime> [gender] [sect]

# 兼容方式（fallback）
tsx scripts/buildBaziFromLunar.ts <lunarTime> [gender] [sect]
```

参数定义 / Parameters:

- `lunarTime`（必填 / required）
  - 格式：ISO 8601 日期时间（不带时区），如 `1990-04-21T14:30:00`
  - 默认值：无
  - 非法输入：格式不合法或为空时，由底层解析失败并报错
- `gender`（可选 / optional）
  - 取值范围：`1`（男 / male）、`0`（女 / female）
  - 默认值：`1`
  - 非法输入：抛错 `性别参数无效。男性传 1，女性传 0。`
- `sect`（可选 / optional）
  - 取值范围：`1`（23:00-23:59 视为明天）、`2`（23:00-23:59 视为当天）
  - 默认值：`2`
  - 非法输入：抛错 `早晚子时配置参数无效。传 1 表示 23:00-23:59 日干支为明天，传 2 表示 23:00-23:59 日干支为当天。`

### `scripts/convertToTrueSolarTime.ts`（真太阳时换算）

```bash
# 推荐方式
node scripts/convertToTrueSolarTime.ts <beijingTime> <longitudeOrCity> [standardLongitude]

# 兼容方式（fallback）
tsx scripts/convertToTrueSolarTime.ts <beijingTime> <longitudeOrCity> [standardLongitude]
```

参数定义 / Parameters:

- `beijingTime`（必填 / required）
  - 含义：北京时间（东八区标准时）输入时间
  - 格式：`YYYY-MM-DDTHH:mm[:ss]`（不带时区），如 `1990-05-15T14:30:00`
  - 默认值：无
  - 非法输入：抛错 `时间格式无效...请使用不带时区的 YYYY-MM-DDTHH:mm[:ss]...`
- `longitudeOrCity`（必填 / required）
  - 含义：可直接传经度，或传城市名由脚本自动匹配经度
  - 经度格式：十进制度数，范围 `-180` 到 `180`（如武汉 `114.17`）
  - 城市格式：城市名（支持常见后缀，如 `武汉`、`武汉市`）
  - 默认值：无
  - 非法输入：地点无法识别时抛错 `无法识别地点...请传经度或城市名...`
- `standardLongitude`（可选 / optional）
  - 含义：标准经度，默认 `120`（北京时间基准经线）
  - 取值范围：`-180` 到 `180`
  - 默认值：`120`
  - 非法输入：抛错 `standardLongitude 无效...` 或 `standardLongitude 超出范围...`

输出 / Output:

- 标准输出仅返回 1 行真太阳时时间字符串（`YYYY-MM-DDTHH:mm:ss`），可直接作为 `buildBaziFromSolar.ts` 与 `queryFortuneRange.ts` 的 `solar` 时间参数。

### `scripts/getChineseCalendar.ts`（黄历/农历查询）

```bash
# 推荐方式（不传参默认今天）
node scripts/getChineseCalendar.ts [date]

# 兼容方式（fallback）
tsx scripts/getChineseCalendar.ts [date]
```

参数定义 / Parameters:

- `date`（可选 / optional）
  - 格式：`YYYY-MM-DD`（兼容 `YYYY/MM/DD`），如 `2024-02-10`
  - 默认值：当天日期
  - 取值范围：有效公历日期
  - 非法输入：
    - 格式错误时抛错 `日期格式无效。请传入 YYYY-MM-DD（也兼容 YYYY/MM/DD）。`
    - 日期不存在时抛错 `日期值无效。请确认年月日是实际存在的日期。`

### `scripts/queryFortuneRange.ts`（大运/流年/流月/流日/流时区间查询）

```bash
# 推荐方式
node scripts/queryFortuneRange.ts '<json>'

# 兼容方式（fallback）
tsx scripts/queryFortuneRange.ts '<json>'
```

参数定义 / Parameters:

- `json`（必填 / required）
  - 格式：JSON 字符串，结构如下：
    - `birth.calendar`（必填）：`solar` 或 `lunar`
    - `birth.time`（必填）：出生时间（不带时区），如 `1990-05-15T14:30:00`
    - `birth.gender`（可选）：`1` 男，`0` 女，默认 `1`
    - `birth.sect`（可选）：`1` 或 `2`，默认 `2`
    - `query.startDateTime`（必填）：`YYYY-MM-DD` 或 `YYYY-MM-DDTHH`
    - `query.endDateTime`（必填）：`YYYY-MM-DD` 或 `YYYY-MM-DDTHH`
    - `query.level`（可选）：`year`、`month`、`day`、`hour`，默认 `year`
  - 自动补全规则：
    - `startDateTime` 传 `YYYY-MM-DD` 时补为 `T00`
    - `endDateTime` 传 `YYYY-MM-DD` 时补为 `T23`
  - 结果规则：
    - `level` 采用层级语义：`year < month < day < hour`
    - 自动补父级：查 `day` 自动包含 `year+month`；查 `hour` 自动包含 `year+month+day`
    - `level=hour` 时返回流时，输出会将连续相同流时合并为时辰段（2 小时语义）
    - 查询层级达到 `month` 时返回按连续干支月分段的流月区间
    - 流年/流月/流日/流时结果均包含：干支、十神、神煞、与原命盘的刑冲合会关系
    - 输出固定为完整 Markdown（按层级标题展开全部字段，不使用代码块），不做省略与去重
  - 非法输入：
    - JSON 非法时抛错 `参数 JSON 解析失败。请传入合法 JSON。`
    - 时间格式错误时抛错 `时间格式无效...请使用 YYYY-MM-DD 或 YYYY-MM-DDTHH...`
    - `startDateTime` 晚于 `endDateTime` 时抛错 `时间范围无效：startDateTime 不能晚于 endDateTime。`
    - `level=hour` 且范围超过 62 天时抛错 `hour 查询区间过大...`

## 示例 / Examples

```bash
# buildBaziFromSolar.ts 最小可用示例
node scripts/buildBaziFromSolar.ts "1990-05-15T14:30:00"

# buildBaziFromLunar.ts 最小可用示例
node scripts/buildBaziFromLunar.ts "1990-04-21T14:30:00"

# convertToTrueSolarTime.ts 最小可用示例（武汉经度）
node scripts/convertToTrueSolarTime.ts "1990-05-15T14:30:00" 114.17

# convertToTrueSolarTime.ts 城市名示例（无需手查经度）
node scripts/convertToTrueSolarTime.ts "1990-05-15T14:30:00" 武汉

# getChineseCalendar.ts 最小可用示例（默认今天）
node scripts/getChineseCalendar.ts

# getChineseCalendar.ts 指定日期
node scripts/getChineseCalendar.ts 2024-02-10

# queryFortuneRange.ts: 查询 2026-2028 流年
node scripts/queryFortuneRange.ts '{"birth":{"calendar":"solar","time":"1990-05-15T14:30:00","gender":1,"sect":2},"query":{"startDateTime":"2026-01-01","endDateTime":"2028-12-31","level":"year"}}'

# queryFortuneRange.ts: 查询下个月流日（按日）
node scripts/queryFortuneRange.ts '{"birth":{"calendar":"solar","time":"1990-05-15T14:30:00"},"query":{"startDateTime":"2026-05-01","endDateTime":"2026-05-31","level":"day"}}'

# queryFortuneRange.ts: 查询某段流时（按时辰段合并）
node scripts/queryFortuneRange.ts '{"birth":{"calendar":"solar","time":"1990-05-15T14:30:00"},"query":{"startDateTime":"2026-05-01T09","endDateTime":"2026-05-03T18","level":"hour"}}'

# 两步流程示例：先换算真太阳时，再排盘（示例结果需替换为实际换算输出）
node scripts/convertToTrueSolarTime.ts "1990-05-15T14:30:00" 114.17
node scripts/buildBaziFromSolar.ts "1990-05-15T14:10:20" 1 2
```

## 注意事项 / Notes

1. 所有命令均在 skill 根目录执行，不依赖仓库根目录路径。 / Run all commands in the skill root; do not rely on repo-root paths.
2. 时间字符串不要携带时区后缀（如 `Z`、`+08:00`），以免产生与预期不一致的换日结果。 / Do not append timezone suffixes (such as `Z` or `+08:00`) to avoid unexpected day shifts.
3. 若要按真太阳时排盘，请先运行 `convertToTrueSolarTime.ts`，再把输出时间传给其它脚本；其它脚本本身不做真太阳时换算。 / For true solar time workflow, run `convertToTrueSolarTime.ts` first and pass its output to other scripts.
4. 涉及 23:00-23:59 出生时，建议显式传 `sect`，避免晚子时归属歧义。 / For births between 23:00-23:59, explicitly set `sect` to avoid ambiguity.
5. `queryFortuneRange.ts` 的 `startDateTime/endDateTime` 只支持 `YYYY-MM-DD` 或 `YYYY-MM-DDTHH`，不支持分钟秒。 / `queryFortuneRange.ts` supports only `YYYY-MM-DD` and `YYYY-MM-DDTHH` for range inputs.
6. 真太阳时换算只依赖经度，不需要纬度；脚本支持直接传城市名自动匹配经度。 / True solar time conversion uses longitude only; latitude is not required.
