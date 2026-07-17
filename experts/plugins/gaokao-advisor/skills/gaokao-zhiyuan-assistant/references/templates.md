# T1 / T2 表格模板（公开腾讯文档 · copy_file 蓝本）

> skill 在「阶段二」**直接用 `manage.copy_file` 克隆下面两份公开腾讯文档**作为用户专属表，**而不是从零 `manage.create_file` 重建**。版式、合并单元格、列宽、冻结、下拉选项、预填的"影响"/"示例"列等模板已写好的内容随副本继承，不需要 AI 再用工具重写。
>
> **重要：T1 是普通在线表格（sheet），T2 是智能表格（smartsheet），两者读写工具完全不同，混用会报错。**

## 模板登记

| 表 | 文档类型 | 公开文档（人类可访问） | 模板 file_id（用于 `manage.copy_file`） |
| --- | --- | --- | --- |
| T1 专业初筛表 | **sheet**（普通在线表格） | https://docs.qq.com/sheet/DQW5weUtOTEJKV094?tab=000001 | `DQW5weUtOTEJKV094` |
| T2 个人情况分析表 | **smartsheet**（智能表格） | https://docs.qq.com/smartsheet/DQUZDVFNJb2dMR2pi?tab=sc_jCfgz3 | `DQUZDVFNJb2dMR2pi` |

> file_id 取自 url 路径段：`docs.qq.com/{sheet|smartsheet}/<file_id>?tab=...`
> **注意**：T2 的 url 路径是 `smartsheet` 不是 `sheet`，副本 url 同样保持 `smartsheet`，必须走 smartsheet 工具链。

## 标题约定（重要）

`manage.copy_file` 调用时**显式传 `title`，沿用模板原标题，不要加"副本"二字、不要加用户名/年份等任何前后缀**。例：

- T1 副本标题：`T1专业初筛表`
- T2 副本标题：`T2_个人情况分析表`

> 若不传 `title`，腾讯文档默认会在原标题后追加"副本"，**必须主动传 title 覆盖**。

## 调用范式

### T1（sheet）

```python
# 1. 克隆
copy = manage.copy_file(file_id="DQW5weUtOTEJKV094", title="T1专业初筛表")
user_t1_file_id = copy["id"]      # 例：OazYObGsuDah
user_t1_url     = copy["url"]     # 例：https://docs.qq.com/sheet/DT2F6WU9iR3N1RGFo

# 2. 取 sheet_id（不硬编码）
info = sheet.get_sheet_info(file_id=user_t1_file_id)
t1_sheet_id = info["sheets"][0]["sheet_id"]   # 实测 "000001"，仍需走接口取

# 3. 仅写入用户专属内容（可选预填，不重写表头/影响列/示例列）
sheet.set_range_value(file_id=user_t1_file_id, sheet_id=t1_sheet_id, range="...", values=[...])
```

### T2（smartsheet）—— **不同工具链，重点关注**

```python
# 1. 克隆
copy = manage.copy_file(file_id="DQUZDVFNJb2dMR2pi", title="T2_个人情况分析表")
user_t2_file_id = copy["id"]      # 例：OxrrGBIqanjQ
user_t2_url     = copy["url"]     # 例：https://docs.qq.com/smartsheet/DT3hyckdCSXFhbmpR

# 2. 取子表 sheet_id（smartsheet 用 list_tables，不是 get_sheet_info）
tables = smartsheet.list_tables(file_id=user_t2_file_id)
# 实测含两个子表：
#   - {"sheet_id": "sc_jCfgz3", "title": "填写说明"}     → 只读说明区，跳过
#   - {"sheet_id": "PnKY7h",    "title": "个人情况分析表"} → 主填写区
# 注意：smartsheet 的 sheet_id 是非数字字符串，不是 "000001"
t2_main_sheet_id = next(s["sheet_id"] for s in tables["sheets"] if s["title"] == "个人情况分析表")

# 3. 取字段映射
fields = smartsheet.list_fields(file_id=user_t2_file_id, sheet_id=t2_main_sheet_id)
# 返回 [{"field_id": "fzLYgB", "field_title": "填写示例(参考)", "field_type": "text"}, ...]
field_map = {f["field_title"]: f["field_id"] for f in fields["fields"]}

# 4. 仅写入用户专属内容（用 add_records / update_records，不是 set_range_value）
smartsheet.add_records(
    file_id=user_t2_file_id,
    sheet_id=t2_main_sheet_id,
    records=[{"fields": {field_map["某字段标题"]: "用户值", ...}}]
)
```

复制后再走原有流程：

1. 给用户文档链接 + 填写引导，等"我填完了"。
2. 用 `get_content`（或 `smartsheet.list_records` for T2）读回校验，**未读到用户实际填写内容前不得进入解读**。

## 实测结论（2026-06-04）

| 验证项 | T1 (sheet) | T2 (smartsheet) |
| --- | --- | --- |
| `manage.copy_file` 克隆 | ✅ 副本 `OazYObGsuDah` | ✅ 副本 `OxrrGBIqanjQ` |
| title 透传（不带"副本"后缀） | ✅ | ✅ |
| 副本结构继承 | ✅ 25 列 × 95 行，子表 `专业初选` | ✅ 两个子表（`填写说明` + `个人情况分析表`），字段类型/分组选项完整继承 |
| 取 sheet_id 接口 | `sheet.get_sheet_info` → `000001` | `smartsheet.list_tables` → 非数字字符串（如 `PnKY7h`） |
| 写入接口 | `sheet.set_range_value` | `smartsheet.add_records` / `smartsheet.update_records` |
| 读取接口 | `get_content` / `sheet.get_cell_data` | `smartsheet.list_records` / `get_content` |
| 副本 url 路径 | `/sheet/<id>` | `/smartsheet/<id>` |

## 模板维护规则（开发同学注意）

- **只能扩展、不能破坏字段顺序/字段 ID**：模板里的列序或字段 ID 一旦变，AI 阶段二按字段名/位置写入就会写错位置或报字段不存在。新增列/字段请追加在末尾。
- **修改模板 = 直接编辑那两份公开腾讯文档**，不需要发版 skill。
- 修改后**保留版本注释**（在文档首行或某只读单元格里写 `tpl_version: vYYYYMMDD`），便于排查。
- **不要修改这两份模板的 file_id / 公开访问权限 / 文件类型**（普通 sheet ↔ smartsheet 互转会导致 file_id 失效）；如需更换模板，更新本文件登记的 file_id 即可。
- **T2 smartsheet 切勿误转为普通 sheet**，否则字段类型（分组、单选、关联等）会丢失，且 skill 调用链全部失效。

## 容错与降级

### 排查优先级（重要：先排查再降级）

`copy_file` 报错时**禁止直接降级**，必须先按以下顺序排查（详见 SKILL.md 第九节"MCP 错误码 → 排查顺序"）：

1. **CLI 参数名错误（最高频，> 70%）**：若通过 `mcporter` 等 shell CLI 调用，先确认参数语法是 `--args '<json>'`，**不是 `--params` / `--data` / `--json`**。误用 `--params` 时 CLI 会忽略选项导致 server 收到空参数，对 `manage.copy_file` 返回 `Resource Not Exist`——这是参数没传到，**不是模板被删**。第一次用 CLI 前务必跑 `mcporter call --help` 确认。
2. **file_id 拼写错误**：核对大小写、首尾空格，模板 file_id 不带 `D` 前缀（`D` 前缀只出现在 url 里）。
3. **权限/网络问题**：换原生 MCP 通道复测，或在浏览器手动打开模板 url 验证公开可访问。
4. **以上全部排除后**，才能判定为"模板真被删/权限变更"，执行下方降级方案。

> ⚠️ T1/T2 模板（`DQW5weUtOTEJKV094` / `DQUZDVFNJb2dMR2pi`）已在生产环境长期稳定可访问。**误判降级会丢失 T2 智能表格的标签字段、视图等高级能力**，对用户体验有明显损伤。

### 降级方案（仅在排查 1-3 全部失败后启用）

- **T1**：`manage.create_file(file_type="sheet")` 建空表 + `sheet.set_range_value` 按 `assets/T1_专业初筛表_模板.md` 重建表头与初始行。
- **T2**：`manage.create_file(file_type="smartsheet")` + `smartsheet.add_fields` 重建字段 + `smartsheet.add_records` 写入初始行，参考 `assets/T2_个人情况分析表_v2_模板.md` 字段定义。
- 降级后必须在用户话术里**显式说明"体验降级"**（T2 失去标签字段、视图等能力）。

两份 .md 模板因此**仍需保留**，定位为"降级蓝本 + 字段说明文档"。

## 历史 file_id（已废弃，仅供回溯）

| 表 | 旧 file_id | 状态 | 弃用日期 |
| --- | --- | --- | --- |
| T1 | `DT2RKRFR6aFhTZGxt` | 已替换 | 2026-06-04 |
| T2 | `DT3VKZVpoR0tib01w` | 已替换（且原为普通 sheet，新版升级为 smartsheet） | 2026-06-04 |

> 旧 file_id 不再维护，AI **严禁**再使用。如发现历史会话/缓存里残留旧 id，必须改用上面的新 id。
