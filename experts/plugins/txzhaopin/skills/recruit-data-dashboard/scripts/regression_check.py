#!/usr/bin/env python3
"""
知识库回归测试（v3.5 沉淀）

【目的】把 v3.0~v3.5 治理过程中沉淀的所有经验，固化为可一键运行的检查规则。
       每次知识库更新后自动跑，第一时间发现一致性破坏。

【使用】
  方式 1（独立）：python3 regression_check.py
  方式 2（CI）：sync_knowledge.py 已集成调用，同步后自动跑

【退出码】
  0  - 全部通过
  1  - 发现 🔴 致命问题（阻塞同步/打包）
  2  - 仅发现 🟡 警告（不阻塞，但建议修）

【规则集 6 类】
  R1: SQL 块语法层（C1 时间方向 + C2 聚合方式 + C4 is_xxx 值）
  R2: 完整 SQL 卡的强制过滤（C3 + 国家+管理主体 v3.4 铁律）
  R3: 跨表 JOIN 模式（C5 子查询模式）
  R4: 卡顶元数据声明完整性（v3.5 新规则）
  R5: 指标 ID ↔ 治理基线映射覆盖率（v3.4 沉淀）
  R6: SKILL.md 全局铁律存在性（v3.4/3.5 沉淀）

【设计】每条规则都内置"误报豁免"机制（exception_keywords）
       规则失败时输出可定位的文件路径 + 子标题 + 原文片段
"""
from __future__ import annotations
import re
import json
import sys
from pathlib import Path
from typing import Callable
from dataclasses import dataclass, field

# ============ 路径解析 ============
# 命令行支持 --source=sandbox|skill 切换扫描目标
#   --source=skill（默认）：扫 skill 内 knowledge/（CI / 打包前用）
#   --source=sandbox：扫沙箱 .knowledge/（开发期改完立即跑用，无需先 sync）
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
SANDBOX_DIR = SKILL_DIR.parent

source_mode = 'skill'  # 默认
for arg in sys.argv[1:]:
    if arg.startswith('--source='):
        source_mode = arg.split('=', 1)[1]
    elif arg in ('--sandbox', '-s'):
        source_mode = 'sandbox'

if source_mode == 'sandbox':
    KNOWLEDGE_ROOT = SANDBOX_DIR / '.knowledge'
elif source_mode == 'skill':
    KNOWLEDGE_ROOT = SKILL_DIR / 'knowledge'
else:
    print(f'❌ 未知 source 模式: {source_mode}', file=sys.stderr)
    sys.exit(1)

if not (KNOWLEDGE_ROOT / 'metrics').exists():
    # 自动回退到另一个
    fallback = SKILL_DIR / 'knowledge' if source_mode == 'sandbox' else SANDBOX_DIR / '.knowledge'
    if (fallback / 'metrics').exists():
        print(f'⚠️  指定的 {source_mode} 不存在，回退到 {fallback}', file=sys.stderr)
        KNOWLEDGE_ROOT = fallback
        source_mode = 'fallback'
    else:
        print(f'❌ 找不到 knowledge/ 或 .knowledge/ 根目录', file=sys.stderr)
        sys.exit(1)

METRICS_DIR = KNOWLEDGE_ROOT / 'metrics'
SKILL_MD = SKILL_DIR / 'SKILL.md'
BASELINE_RAW = KNOWLEDGE_ROOT / 'source/社招统计指标.raw.json'
if not BASELINE_RAW.exists():
    BASELINE_RAW = SANDBOX_DIR / '.knowledge/source/社招统计指标.raw.json'
INDEX_PATH = KNOWLEDGE_ROOT / '_audit/metrics-search-index.json'


# ============ 数据结构 ============
@dataclass
class Issue:
    rule_id: str
    severity: str  # 🔴 / 🟡 / ⚪
    file: str
    title: str
    detail: str

    def __str__(self):
        s = f'  {self.severity} [{self.rule_id}] {self.file}'
        if self.title:
            s += f'\n      § {self.title}'
        if self.detail:
            s += f'\n      ⚙ {self.detail}'
        return s


@dataclass
class CheckResult:
    name: str
    passed: bool
    issues: list[Issue] = field(default_factory=list)
    info: str = ''


# ============ 工具函数 ============
def extract_active_sql_blocks(text: str):
    """提取所有非废弃的 SQL 块。返回 [(sql, title, position), ...]"""
    blocks = []
    DEPRECATED_KEYWORDS = [
        '废弃', '不再符合', '历史表达式', 'v3.0/3.1 历史', 'v2.x 历史', 'v2.x',
        '不推荐', '已废弃', '反例', '错误写法', '失败', 'v3.1 之前',
        # 教学样例上下文
        '勘误 A', '勘误 B', '失败示例',
    ]
    for m in re.finditer(r'```sql\n(.*?)```', text, re.DOTALL):
        sql = m.group(1)
        # 取该 SQL 块前 400 字（含 6-8 行）
        prec = text[max(0, m.start() - 400):m.start()]
        # 取 SQL 块本身的注释行（首 3 行）
        first_lines = '\n'.join(sql.split('\n')[:3])
        ctx = prec + first_lines

        # 跳过废弃/反例/教学
        if any(kw in ctx for kw in DEPRECATED_KEYWORDS):
            continue

        # 找子标题
        lines_before = text[:m.start()].split('\n')
        title = ''
        for ln in reversed(lines_before):
            if ln.startswith('## ') or ln.startswith('### '):
                title = ln.strip()
                break

        blocks.append((sql, title, m.start()))
    return blocks


def is_full_sql(sql: str) -> bool:
    """是否是完整 SQL（含 SELECT...FROM...WHERE）"""
    return bool(re.search(r'^\s*(SELECT|WITH)\b', sql, re.M | re.I)) and 'FROM' in sql.upper()


def strip_sql_comments(sql: str) -> str:
    """去 SQL 注释（避免误扫注释里的关键词）"""
    sql = re.sub(r'--[^\n]*', '', sql)
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    return sql


# ============ 规则 R1：SQL 块语法（时间方向 + 聚合 + is_xxx）============
def rule_R1_sql_syntax() -> CheckResult:
    """SQL 块语法一致性检查"""
    issues = []
    for md in METRICS_DIR.rglob('*.md'):
        if '_legacy' in str(md): continue
        if md.name in ('README.md', '_README.md'): continue
        text = md.read_text(encoding='utf-8')
        rel = str(md.relative_to(METRICS_DIR))
        for sql, title, _ in extract_active_sql_blocks(text):
            sql_clean = strip_sql_comments(sql)

            # R1.1: begin_date 用 > 而非 >=
            for m in re.finditer(r"(\w+_time|\w+_date)\s*>\s*:begin_date(?!\s*\+)", sql_clean):
                issues.append(Issue('R1.1', '🔴', rel, title,
                                    f'begin_date 应用 >= 而非 >: {m.group(0)}'))

            # R1.2: DATE_ADD 错配 begin_date（应该是 end_date）
            for m in re.finditer(r"DATE_ADD\(:begin_date,\s*INTERVAL\s+1\s+DAY\)", sql_clean):
                issues.append(Issue('R1.2', '🔴', rel, title,
                                    f'DATE_ADD 应包 :end_date 而非 :begin_date'))

            # R1.3: SUM(CASE WHEN ... THEN 1 ELSE 0 END) v2.x 写法
            sum_case = re.findall(r"SUM\s*\(\s*CASE\s+WHEN[^)]{1,300}?\s+THEN\s+1\s+ELSE\s+0\s+END\s*\)",
                                  sql_clean, re.I | re.S)
            if sum_case:
                issues.append(Issue('R1.3', '🟡', rel, title,
                                    f'用了 v2.x SUM(CASE) 写法，应改为 COUNT(DISTINCT CASE...flow_main_id END) ({len(sum_case)} 处)'))

            # R1.4: is_xxx = 1 或 = 0 旧写法（is_disabled 例外）
            for m in re.finditer(r"(is_\w+)\s*=\s*['\"]?[01]['\"]?(?!\d)", sql_clean):
                field_name = m.group(1)
                if field_name == 'is_disabled':
                    continue  # 合法 v3.2 写法，CASE 内置 0
                issues.append(Issue('R1.4', '🔴', rel, title,
                                    f'{m.group(0)} 应改为 {field_name} = \'是\'（StarRocks 取值是中文）'))

    return CheckResult(
        name='R1: SQL 语法一致性（时间方向/聚合/is_xxx）',
        passed=not any(i.severity == '🔴' for i in issues),
        issues=issues,
    )


# ============ 规则 R2：完整 SQL 卡强制过滤（v3.4 铁律）============
def rule_R2_full_sql_required_filters() -> CheckResult:
    """完整 SQL 卡（含 SELECT FROM）必须带 4 条强制过滤"""
    issues = []
    for md in METRICS_DIR.rglob('*.md'):
        if '_legacy' in str(md): continue
        if md.name in ('README.md', '_README.md'): continue
        # filter-parameters.md 含教学示例，豁免（卡顶已声明）
        if md.name == 'filter-parameters.md': continue

        text = md.read_text(encoding='utf-8')
        rel = str(md.relative_to(METRICS_DIR))
        for sql, title, _ in extract_active_sql_blocks(text):
            if not is_full_sql(sql):
                continue
            sql_clean = strip_sql_comments(sql)

            uses_flow = 'Report_Recruit_Flow_Detail' in sql_clean
            uses_assess = 'Report_Recruit_Resume_Assessment' in sql_clean
            uses_post = 'Report_Position_Management' in sql_clean

            # 用 T_FLOW
            if uses_flow:
                if 'staff_type_id' not in sql_clean:
                    issues.append(Issue('R2.1', '🔴', rel, title,
                                        'T_FLOW 完整 SQL 必须有 staff_type_id'))
                # flow_id 仅当不含活水时强制（活水分支用 flow_id=5）
                if 'flow_id' not in sql_clean:
                    issues.append(Issue('R2.2', '🔴', rel, title,
                                        'T_FLOW 完整 SQL 必须有 flow_id'))
                if 'location_country_name' not in sql_clean:
                    issues.append(Issue('R2.3', '🔴', rel, title,
                                        'T_FLOW 完整 SQL 必须有 location_country_name (v3.4 铁律)'))
                if 'manager_unit_name_cn' not in sql_clean and 'manager_unit_id' not in sql_clean:
                    issues.append(Issue('R2.4', '🔴', rel, title,
                                        'T_FLOW 完整 SQL 必须有 manager_unit_name_cn (v3.4 铁律)'))
            # 用 T_ASSESS（除非也用了 T_FLOW，那以 T_FLOW 为准）
            if uses_assess and not uses_flow:
                if 'location_country_name' not in sql_clean:
                    issues.append(Issue('R2.5', '🔴', rel, title,
                                        'T_ASSESS 完整 SQL 必须有 location_country_name (v3.4 铁律)'))
                # T_ASSESS 不应有 flow_id
                if re.search(r'\bflow_id\s*=\s*\d', sql_clean):
                    issues.append(Issue('R2.6', '🔴', rel, title,
                                        'T_ASSESS 表 SQL 不应加 flow_id 过滤 (README 勘误 B)'))
            # 用 T_POST 单表（不联 T_FLOW/T_ASSESS）
            if uses_post and not uses_flow and not uses_assess:
                if 'is_disabled_name' not in sql_clean:
                    # 允许 is_disabled = '1' 在 CASE 内的合法写法
                    if not re.search(r"is_disabled\s*=\s*['\"][01]['\"]", sql_clean):
                        issues.append(Issue('R2.7', '🔴', rel, title,
                                            'T_POST 完整 SQL 必须有 is_disabled_name 过滤'))
                if 'recruit_staff_type_name' not in sql_clean:
                    issues.append(Issue('R2.8', '🔴', rel, title,
                                        'T_POST 完整 SQL 必须有 recruit_staff_type_name'))

            # 🆕 v3.6：T_FLOW + T_POST 联合时，T_POST 子查询也必须带 recruit_staff_type_name
            # （治理基线：所有"T_FLOW + T_POST 联合"指标都要求 T_POST 侧 recruit_staff_type_name='正式'）
            if uses_post and (uses_flow or uses_assess):
                if 'recruit_staff_type_name' not in sql_clean:
                    issues.append(Issue('R2.9', '🔴', rel, title,
                                        'T_FLOW+T_POST 联合时 T_POST 子查询也必须带 recruit_staff_type_name=\'正式\'（治理基线要求）'))

    return CheckResult(
        name='R2: 完整 SQL 卡强制过滤（v3.4 铁律）',
        passed=not any(i.severity == '🔴' for i in issues),
        issues=issues,
    )


# ============ 规则 R3：跨表 JOIN 子查询模式 ============
def rule_R3_join_subquery_pattern() -> CheckResult:
    """跨表 JOIN 必须用"先子查询过滤再 JOIN"模式（避免 dos_current_user 列冲突）"""
    issues = []
    for md in METRICS_DIR.rglob('*.md'):
        if '_legacy' in str(md): continue
        if md.name in ('README.md', '_README.md'): continue

        text = md.read_text(encoding='utf-8')
        rel = str(md.relative_to(METRICS_DIR))
        for sql, title, _ in extract_active_sql_blocks(text):
            sql_clean = strip_sql_comments(sql)
            # 同时用了 T_FLOW + T_POST 才检查
            if 'Report_Recruit_Flow_Detail' not in sql_clean: continue
            if 'Report_Position_Management' not in sql_clean: continue
            # 找 JOIN 形式
            direct_joins = re.findall(r'\bJOIN\s+catalog_\w+\.\w+\.\w+', sql_clean, re.I)
            subquery_joins = re.findall(r'\bJOIN\s*\(\s*SELECT', sql_clean, re.I)
            if direct_joins and not subquery_joins:
                issues.append(Issue('R3.1', '🔴', rel, title,
                                    f'跨表 JOIN 用了直连模式（{len(direct_joins)} 处），应改子查询模式（README 勘误 A）'))

    return CheckResult(
        name='R3: 跨表 JOIN 子查询模式',
        passed=not any(i.severity == '🔴' for i in issues),
        issues=issues,
    )


# ============ 规则 R4：卡顶元数据完整性（v3.5）============
def rule_R4_card_header_metadata() -> CheckResult:
    """T_FLOW/T_ASSESS 指标卡的卡顶必须显式声明国家+管理主体参数"""
    issues = []
    SKIP_FILES = ('README.md', '_README.md', 'metric-index.md',
                  'dimensions.md', 'filter-parameters.md', 'avg-recruit-days.md')
    for md in METRICS_DIR.rglob('*.md'):
        if '_legacy' in str(md): continue
        if md.name in SKIP_FILES: continue

        text = md.read_text(encoding='utf-8')
        rel = str(md.relative_to(METRICS_DIR))
        # 是不是用 T_FLOW 或 T_ASSESS 的卡
        if not ('Report_Recruit_Flow_Detail' in text or
                'Report_Recruit_Resume_Assessment' in text or
                'T_FLOW' in text[:2500]):
            continue

        # 卡顶 = 文件前 3000 字
        head = text[:3000]
        if 'location_country_name' not in head:
            issues.append(Issue('R4.1', '🔴', rel, '',
                                '卡顶元数据缺 :location_country_name 参数声明 (v3.4/3.5 铁律)'))
        if 'manager_unit_name_cn' not in head:
            issues.append(Issue('R4.2', '🟡', rel, '',
                                '卡顶元数据缺 :manager_unit_name_cn 参数声明（建议加）'))

    return CheckResult(
        name='R4: 卡顶元数据完整性（v3.4/3.5 铁律）',
        passed=not any(i.severity == '🔴' for i in issues),
        issues=issues,
    )


# ============ 规则 R5：治理基线 ↔ 指标卡映射覆盖率 ============
def rule_R5_baseline_card_coverage() -> CheckResult:
    """治理基线全量指标必须 100% 映射到指标卡（v3.4 沉淀）"""
    issues = []
    if not BASELINE_RAW.exists() or not INDEX_PATH.exists():
        return CheckResult(
            name='R5: 治理基线映射覆盖率',
            passed=True,
            issues=[],
            info='⏭️ 跳过（找不到治理基线 raw.json 或倒排索引）',
        )

    with open(BASELINE_RAW, encoding='utf-8') as f:
        baseline = json.load(f)
    with open(INDEX_PATH, encoding='utf-8') as f:
        idx = json.load(f)

    baseline_names = [r.get('指标名称') for r in baseline if r.get('指标名称')]

    def find_id(name: str):
        clean = re.sub(r'^\d+\.\s*', '', name).strip()
        for mid, info in idx.items():
            zh_clean = re.sub(r'^\d+\.\s*', '', info['name_zh']).strip()
            if zh_clean == clean: return mid
            if name in (info.get('aliases') or []) or clean in (info.get('aliases') or []):
                return mid
        for mid, info in idx.items():
            zh_clean = re.sub(r'^\d+\.\s*', '', info['name_zh']).strip()
            if clean in zh_clean or zh_clean in clean:
                return mid
        return None

    unmapped = [n for n in baseline_names if not find_id(n)]
    info = f'治理基线指标数：{len(baseline_names)}，已映射：{len(baseline_names) - len(unmapped)}'

    for n in unmapped:
        issues.append(Issue('R5.1', '🟡', '治理基线', '',
                            f'指标 "{n}" 未在倒排索引中找到对应卡 → 需补同义词或缺卡'))

    return CheckResult(
        name='R5: 治理基线映射覆盖率',
        passed=not any(i.severity == '🔴' for i in issues),
        issues=issues,
        info=info,
    )


# ============ 规则 R6：SKILL.md 全局铁律存在性 ============
def rule_R6_skill_md_rules() -> CheckResult:
    """SKILL.md 必须包含 v3.3/3.4 沉淀的关键原则"""
    issues = []
    if not SKILL_MD.exists():
        return CheckResult(
            name='R6: SKILL.md 全局铁律',
            passed=False,
            issues=[Issue('R6.0', '🔴', 'SKILL.md', '', '文件不存在')],
        )

    text = SKILL_MD.read_text(encoding='utf-8')

    # 每条规则可以用多个关键词的任一匹配（or 逻辑）以兼容措辞变化
    REQUIRED_RULES = [
        ('R6.1', ['BG 中文全路径速查表', 'BG 中文'], '必须有 BG 中文全路径速查表（避免 LIKE \'%TEG%\' 等误用）'),
        ('R6.2', ['腾讯集团本部'], '必须有默认管理主体 = 腾讯集团本部 的规则'),
        ('R6.3', ['v3.4 新增铁律', 'v3.4'], '必须有 v3.4 强制参数铁律（国家+管理主体必带）'),
        ('R6.4', ['以治理基线为准', '治理基线为最终真相源', '为最终真相源'],
                  '必须强调以治理基线为准（v3.3 沉淀）'),
        ('R6.5', ['send_offer_time'], '必须解释 send_offer_time >= end_date 反直觉为什么对'),
        ('R6.6', ['治理口径约定', 'end_date 不是用户原始日期', 'DATE_ADD(:end_date, INTERVAL 1 DAY)'],
                  '必须有 v3.8 治理口径 end_date 映射铁律（避免时点 OR NULL 字段方向误读）'),
        ('R6.7', ['通过率/转化率强约束', 'Step 1.5', 'funnel-rates 路径'],
                  '必须有 v3.9 通过率/转化率强约束铁律（禁止 AI 自由发散写率类公式）'),
        ('R6.8', ['recruit-send-offer-rate', 'recruit-entry-rate', 'recruit-hr-intv-rate'],
                  '必须列出 9 个已治理通过率清单（确保 AI 能精确路由）'),
        ('R6.9', ['禁止自由发散', '不要自己拼公式', '禁止自由发散写率类公式', '不得跳步'],
                  '必须明确禁止 AI 自创率类公式（v3.9）'),
    ]
    for rid, kws, desc in REQUIRED_RULES:
        if not any(kw in text for kw in kws):
            issues.append(Issue(rid, '🟡', 'SKILL.md', '', desc))

    return CheckResult(
        name='R6: SKILL.md 全局铁律完整性',
        passed=not any(i.severity == '🔴' for i in issues),
        issues=issues,
    )


# ============ R7: 时间字段方向（v3.8 新增）============
def rule_R7_time_field_direction() -> CheckResult:
    """
    扫描所有 SQL 块，检查时点 OR NULL 字段是否符合治理口径 end_date 映射规则。

    v3.8 核心铁律：治理口径 ":end_date" 已是 用户日期 + 1 天。
    治理口径 "XXX_time >= end_date OR NULL" 在 SQL 中应写为：
      "XXX_time >= DATE_ADD(:end_date, INTERVAL 1 DAY) OR XXX_time IS NULL"

    常见误读模式（应阻塞）：
      "XXX_time > DATE_ADD(:end_date, INTERVAL 1 DAY) OR XXX_time IS NULL"
    （把 ">=" 误写成 ">"，会漏算 end_date 当天结束流程的人）

    白名单：
      - flow_end_time > DATE_ADD(end_date, 1)  当治理口径写 "> end_date"（如 A4 逻辑2、A11 逻辑2 中）
        → 这些场景没有 "OR NULL" 配对，单独 ">" 是合法的
      - 因此本规则只检查 "> DATE_ADD(...) OR ... IS NULL" 这种组合模式
    """
    issues: list[Issue] = []

    # 误读模式：> DATE_ADD(:end_date, ... 1 ... DAY) OR <字段> IS NULL
    # 该字段应出现在 ">"附近，且后面是 OR ... IS NULL → 99%是 ">=" 误写
    BAD_PATTERN = re.compile(
        r'(\w+(?:_time|_date))\s*>\s*DATE_ADD\s*\(\s*:end_date\s*,\s*INTERVAL\s+1\s+DAY\s*\)'
        r'\s*OR\s+\1\s+IS\s+NULL',
        re.IGNORECASE
    )
    # 同样模式但带 `tableAlias.` 前缀（如 t1.flow_end_time > DATE_ADD ... OR t1.flow_end_time IS NULL）
    BAD_PATTERN_PREFIX = re.compile(
        r'(\w+\.\w+(?:_time|_date))\s*>\s*DATE_ADD\s*\(\s*:end_date\s*,\s*INTERVAL\s+1\s+DAY\s*\)'
        r'\s*OR\s+\1\s+IS\s+NULL',
        re.IGNORECASE
    )

    for md in METRICS_DIR.rglob('*.md'):
        if '_legacy' in str(md): continue
        if md.name in ('README.md', '_README.md'): continue
        if md.name == 'filter-parameters.md': continue

        text = md.read_text(encoding='utf-8')
        rel = str(md.relative_to(METRICS_DIR))

        for sql, title, _ in extract_active_sql_blocks(text):
            sql_clean = strip_sql_comments(sql)
            for pattern in (BAD_PATTERN, BAD_PATTERN_PREFIX):
                for m in pattern.finditer(sql_clean):
                    field = m.group(1)
                    # 已知豁免名单：治理口径明确用 `>` 而非 `>=` 的字段
                    # - process_time（Row 25 渠道收到简历未评估数 — 区间型口径）
                    EXEMPT_FIELDS = {'process_time'}
                    field_short = field.split('.')[-1]
                    if field_short in EXEMPT_FIELDS:
                        # 降级为信息提示
                        issues.append(Issue('R7.0', '⚪', rel, title,
                            f'{field} > DATE_ADD(end,1) OR NULL — 已知治理口径使用 ">" 的合法场景（如 Row 25 未评估数），跳过'))
                    else:
                        issues.append(Issue('R7.1', '🔴', rel, title,
                            f'时点 OR NULL 字段方向误读：{field} > DATE_ADD(end,1) OR NULL '
                            f'（应改为 >= DATE_ADD(end,1) OR NULL，按 v3.8 治理口径 end_date 映射铁律。如确认治理口径就是 ">"，请在豁免名单加该字段名）'))

            # R7.2 (v3.8 新增): 检测 `XXX_time OP :end_date` 未扩 1 天的直接写法
            # 治理口径 ":end_date" 已 +1 天，SQL 直接用 :end_date 等于"用户日期"，会偏移 1 天
            DIRECT_END_DATE_PATTERN = re.compile(
                r'\b((?:t\d?\.|reg\.)?\w+(?:_time|_date))\s*([<>]=?)\s*:end_date(?!\w|,)',
                re.IGNORECASE
            )
            for m in DIRECT_END_DATE_PATTERN.finditer(sql_clean):
                field = m.group(1)
                op = m.group(2)
                issues.append(Issue('R7.2', '🔴', rel, title,
                    f'时点字段直接用 :end_date（未扩 1 天）：{field} {op} :end_date '
                    f'（按 v3.8 铁律应改为 {field} {op} DATE_ADD(:end_date, INTERVAL 1 DAY)，因为治理口径的 end_date 已包含 +1 天处理）'))

    return CheckResult(
        name='R7: 时点 OR NULL 字段方向（v3.8 治理口径 end_date 映射铁律）',
        passed=not any(i.severity == '🔴' for i in issues),
        issues=issues,
    )


# ============ R8: source/recipe SQL 一致性（v3.10 新增）============
def rule_R8_source_recipe_consistency() -> CheckResult:
    """
    检测 source 卡（atomic/composite/derived）与 recipe 卡（recipes/）之间，
    同一指标 ID 的 SQL 关键过滤条件集合是否一致。

    v3.10 触发场景：source 卡 v3.3 改了，recipe 卡 v3.0 旧实现未跟进，
    导致 A1 业务语义错（LEFT JOIN + send_offer_time 方向反 + 单位错位）潜伏 7 个版本。

    检查项：对每对 (source_card, recipe_card) 中同名指标，提取 SQL 中关键时间/标志/flow_id 条件集合做对账。
    """
    import re as _re
    issues: list[Issue] = []

    # 已知"指标 ID → (source 文件, source 章节正则, recipe 文件, recipe 章节正则)" 映射
    # 仅纳入有明确多卡 SQL 实现的核心 A 系列指标
    CONSISTENCY_PAIRS = [
        # (label, source_file, source_section_regex, recipe_file, recipe_section_regex)
        ('A3 已完成入职',
         'derived/recruit-social/finished-demand.md', r'## 1\. 已完成需求数（入职）',
         'recipes/recruit-social/card-A-demand-overview.md', r'━━━ A3 已完成需求数（入职）━━━'),
        ('A4 已完成 offer',
         'derived/recruit-social/finished-demand.md', r'## 2\. 已完成需求数（offer）',
         'recipes/recruit-social/card-A-demand-overview.md', r'━━━ A4 已完成需求数（offer）━━━'),
        ('A6 流程中除评估',
         'derived/recruit-social/snapshot-stages.md', r'## 1\. 社招流程中总人数（除简历评估）',
         'recipes/recruit-social/card-A-demand-overview.md', r'━━━ A6 社招流程中（不含简历评估）━━━'),
        ('A8 面试中',
         'derived/recruit-social/snapshot-stages.md', r'## 3\. 面试中',
         'recipes/recruit-social/card-A-demand-overview.md', r'━━━ A8 面试中 ━━━'),
        ('A10 入职中',
         'derived/recruit-social/snapshot-stages.md', r'## 5\. 入职中/调动中',
         'recipes/recruit-social/card-A-demand-overview.md', r'━━━ A10 入职中/调动中 ━━━'),
    ]

    def extract_section_sql(file_path: Path, header_pat: str) -> str | None:
        """提取章节内第一个 sql 块。
        - source 卡：header_pat 是 ## 章节标题，找下一个 ## 或 ``` SQL 块
        - recipe 卡：header_pat 是 ━━━ Ax xxxx ━━━ 注释，找下一个 ━━━ Ax+1 注释
        """
        if not file_path.exists():
            return None
        text = file_path.read_text(encoding='utf-8')
        m = _re.search(header_pat, text)
        if not m:
            return None
        rest = text[m.end():]
        # 章节结束：下一个 ## 标题（source）或下一个 ━━━ Ax ━━━ 注释（recipe）
        end_pats = [
            r'\n## [^#]',           # source 卡的下一个 ## 章节
            r'━━━ A\d',             # recipe 卡的下一个 ━━━ Ax（无论是否在 -- 注释中）
            r'\n```\nFROM \(',      # recipe 卡大 SQL 的 FROM 子句开始
        ]
        end = _re.search('|'.join(f'({p})' for p in end_pats), rest)
        if end:
            rest = rest[:end.start()]
        sql_m = _re.search(r'```sql\n(.*?)```', rest, _re.DOTALL)
        # source 卡有 ```sql 包；recipe 卡 CASE 块直接是 SQL 文本
        return sql_m.group(1) if sql_m else rest

    def extract_key_conds(sql: str) -> set:
        """提取关键条件指纹（时间方向 / 标志 / flow_id / state_id）"""
        s = _re.sub(r'--[^\n]*', '', sql)
        s = _re.sub(r'\s+', ' ', s)
        conds = set()
        # 时间方向 + DATE_ADD/end/begin
        for m in _re.finditer(
            r'(\w+(?:_time|_date))\s*([<>]=?)\s*(DATE_ADD\(:end_date,\s*INTERVAL\s+1\s+DAY\)|:end_date|:begin_date)',
            s, _re.IGNORECASE
        ):
            field = m.group(1).lower()
            op = m.group(2)
            tgt = _re.sub(r'\s+', '', m.group(3))
            conds.add(f'{field}{op}{tgt}')
        # flow_id / state_id / staff_type_id
        for m in _re.finditer(
            r'(flow_id|state_id|staff_type_id)\s*(=|IN|NOT\s+IN)\s*([\(\d, \)\']+)',
            s, _re.IGNORECASE
        ):
            field = m.group(1).lower()
            op = _re.sub(r'\s+', '', m.group(2).upper())
            val = _re.sub(r'\s+', '', m.group(3))
            conds.add(f'{field}{op}{val}')
        # is_xxx
        for m in _re.finditer(r"(is_\w+)\s*=\s*'([^']+)'", s, _re.IGNORECASE):
            conds.add(f"{m.group(1).lower()}='{m.group(2)}'")
        # IS NULL
        for m in _re.finditer(r'(\w+(?:_time|_date))\s+IS\s+(NOT\s+)?NULL', s, _re.IGNORECASE):
            conds.add(f"{m.group(1).lower()}_IS_{'NOT_' if m.group(2) else ''}NULL")
        return conds

    for label, src_file, src_pat, rec_file, rec_pat in CONSISTENCY_PAIRS:
        src_path = METRICS_DIR / src_file
        rec_path = METRICS_DIR / rec_file

        src_sql = extract_section_sql(src_path, src_pat)
        rec_sql = extract_section_sql(rec_path, rec_pat)

        if src_sql is None or rec_sql is None:
            continue  # 找不到就跳过，不算 fail

        src_conds = extract_key_conds(src_sql)
        rec_conds = extract_key_conds(rec_sql)

        only_src = src_conds - rec_conds
        only_rec = rec_conds - src_conds

        if only_src or only_rec:
            diff_summary = []
            if only_src:
                diff_summary.append(f'source 独有: {sorted(only_src)[:3]}{"..." if len(only_src) > 3 else ""}')
            if only_rec:
                diff_summary.append(f'recipe 独有: {sorted(only_rec)[:3]}{"..." if len(only_rec) > 3 else ""}')
            issues.append(Issue('R8.1', '🔴',
                f'{src_file} vs {rec_file}',
                label,
                f'source ↔ recipe SQL 关键条件不一致 — {"; ".join(diff_summary)}'))

    return CheckResult(
        name='R8: source/recipe SQL 一致性（v3.10 新增）',
        passed=not any(i.severity == '🔴' for i in issues),
        issues=issues,
    )


# ============ 主入口 ============
def main():
    rules: list[Callable[[], CheckResult]] = [
        rule_R1_sql_syntax,
        rule_R2_full_sql_required_filters,
        rule_R3_join_subquery_pattern,
        rule_R4_card_header_metadata,
        rule_R5_baseline_card_coverage,
        rule_R6_skill_md_rules,
        rule_R7_time_field_direction,
        rule_R8_source_recipe_consistency,
    ]

    print('═' * 75)
    print('  知识库回归测试（基于 v3.0~v3.10 沉淀的 8 类规则）')
    print('═' * 75)
    print(f'  🔍 source = {source_mode}')
    print(f'  📁 知识库：{KNOWLEDGE_ROOT}')
    print(f'  📁 SKILL.md：{SKILL_MD}')
    print('  💡 用法：python3 regression_check.py [--sandbox | --source=skill]')
    print('─' * 75)

    all_results = [rule() for rule in rules]

    has_critical = False
    has_warning = False

    for r in all_results:
        critical_n = sum(1 for i in r.issues if i.severity == '🔴')
        warn_n = sum(1 for i in r.issues if i.severity == '🟡')
        info_n = sum(1 for i in r.issues if i.severity == '⚪')

        if critical_n > 0:
            status = f'❌ FAIL ({critical_n} 致命)'
            has_critical = True
        elif warn_n > 0:
            status = f'⚠️  WARN ({warn_n} 警告)'
            has_warning = True
        else:
            status = '✅ PASS'

        print(f'\n{status}  {r.name}')
        if r.info:
            print(f'  ℹ️  {r.info}')
        for issue in r.issues:
            print(issue)

    print('\n' + '═' * 75)
    if has_critical:
        print('  🔴 致命问题，请修复后重新运行')
        sys.exit(1)
    elif has_warning:
        print('  🟡 仅有警告，建议修复但不阻塞')
        sys.exit(2)
    else:
        print(f'  🎉 全部 {len(rules)} 类规则通过！')
        sys.exit(0)


if __name__ == '__main__':
    main()
