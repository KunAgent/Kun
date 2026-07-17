# Phase 1 局部更新机制

> **定位**：Phase 1 单次执行原则的**例外**。用户在下游 Phase（2/2.5/2.6/3/4/4.1/5）时改产品/地域/数量，Phase 1 局部更新而非全量重跑。
>
> **设计依据**：决策 partial-update + Phase 1 单次执行原则。详细 PRD 见 [`docs/cpq/phase1-refactor/partial-update.md`](../../../../../docs/cpq/phase1-refactor/partial-update.md)。

---

## 触发场景

| 用户说法                                     | 推断变更类型 |
| -------------------------------------------- | ------------ |
| "再加一个 CLB" / "追加一个对象存储"          | append       |
| "数据盘改成 500GB" / "把那行 CVM 改成 4核8G" | modify       |
| "去掉系统盘" / "把 CVM 那行删了"             | remove       |

### 不算局部更新的场景（必须重启 Phase 1）

| 场景                       | 处置                                          |
| -------------------------- | --------------------------------------------- |
| 用户改了原始 Excel 文件    | 重启 Phase 1（旧 phase1.md 作废）             |
| 用户改 site（cn ↔ intl）   | 重启 Phase 1（站点切换影响所有字典 / 所有行） |
| 用户上传一份完全不同的清单 | 重启 Phase 1                                  |

---

## row_id / status 状态机

### 状态语义

| status    | 含义                             | 下游 Phase 行为  |
| --------- | -------------------------------- | ---------------- |
| `stable`  | Phase 1 + 下游产物已同步         | 直接复用已有产物 |
| `dirty`   | Phase 1 已修改，下游尚未跟进     | 必须重跑该行     |
| `removed` | Phase 1 已标记删除，下游尚未清理 | 必须移除对应产物 |

### 状态转移

```
            (新增)
              │ append
              ↓
            stable                           ← 稳定态
            │  ↑
     modify │  │ downstream_synced
            ↓  │
            dirty                            ← 待重跑
            │
     remove │
            ↓
            removed                          ← 已删除（待 sweep）
            │
     sweep  │
            ↓
        (从 phase1.md 物理删除)
```

### row_id 编码

```
r001, r002, ..., r999
```

- 前缀 `r` + 三位数字
- 单调递增
- **删除的 row_id 不复用**（永久消耗）

---

## update_history 字段

### 格式

```
<!-- update_history:
  2026-06-18T15:00:00 init
  2026-06-18T15:30:12 append:r004 reason="user added CLB for K8s frontend"
  2026-06-18T15:45:33 modify:r003 fields=[规格/子类型] reason="user changed disk to 500GB"
  2026-06-18T16:02:01 remove:r002 reason="user dropped data disk"
  2026-06-18T16:15:55 sweep:r002 (downstream cleared)
-->
```

### 条目语法

```
<ISO 8601 时间戳> <action>:<row_id> [fields=[...]] [reason="..."]
```

| action                       | 必填字段              |
| ---------------------------- | --------------------- |
| `init`                       | -                     |
| `append:<row_id>`            | reason                |
| `modify:<row_id>`            | fields, reason        |
| `remove:<row_id>`            | reason                |
| `downstream_synced:<row_id>` | from（下游 Phase 名） |
| `sweep:<row_id>`             | -                     |

---

## 局部更新执行流程

### Step 1 · AI 识别变更类型 + 确认追问

```
检测到您想做局部更新：
  - 修改：r003 的 规格/子类型 = SSD 数据盘 500GB（原 250GB）

将影响：
  - phase1.md：r003 status = dirty
  - phase2_5.md / phase2_6.md：r003 行重跑
  - phase4.md：r003 关联的 SPU 重新搜索
  - 已写入 CPQ 的 r003：需重新 row update + save

是否确认？[确认 / 取消 / 改成全量重跑]
```

### Step 2 · 仅对受影响行重跑 Phase 1 算法

- 仅扫描 user 指定的变更行（如 r003）
- 重跑 Phase 1 阶段 A.2 / B.2 / B.3 / C / D（局限于该行）
- 其他行 status 保持 stable

### Step 3 · 更新 phase1.md

```diff
 | 3  | r003 | dirty  | 云硬盘 CBS  | SSD 数据盘 500GB | 云硬盘 CBS SSD 500GB | intl | 新加坡 | 腾讯云 | 预留实例 RI 3年 | - | IOPS≥1800 | - |
```

```diff
 <!-- update_history:
   2026-06-18T15:00:00 init
+  2026-06-18T16:30:12 modify:r003 fields=[规格/子类型,搜索关键词] reason="user changed data disk to 500GB"
 -->
```

### Step 4 · 重跑 check-phase1.mjs gate

校验状态机一致性 + 字段合规：

```bash
node plugins/cpq/skills/cpq/scripts/check-phase1.mjs --session-dir <CPQ_SESSION_DIR>
# exit 0 才允许进入下游级联
```

### Step 5 · 通知下游级联失效

主流程提示用户：

```
phase1.md 已更新（r003 status=dirty）。下游 Phase 将按以下规则级联重跑：
  - Phase 2.5：仅对 r003 行重跑（intl 字段透传）
  - Phase 2.6：仅对 r003 行重判 has_spec
  - Phase 3：仅对 r003 调 product batch-search
  - Phase 4：映射表只更新 r003 行让你重新确认
  - Phase 5：仅对 r003 执行 row update + save

是否继续？
```

---

## 下游 Phase 的级联规则

### 各 Phase 启动时的扫描动作

```python
def downstream_phase_startup():
    rows = read_phase1_md()

    stable_rows  = [r for r in rows if r.status == 'stable']
    dirty_rows   = [r for r in rows if r.status == 'dirty']
    removed_rows = [r for r in rows if r.status == 'removed']

    # 顺序：先清理 removed → 再重跑 dirty → 最后复用 stable
    for r in removed_rows:
        delete_from_current_phase_md(r.row_id)

    for r in dirty_rows:
        rerun_current_phase_for_row(r)

    # stable 行：直接复用本 Phase 已有产物
```

### 各下游 Phase 的具体动作

| Phase                | stable | dirty                               | removed                    |
| -------------------- | ------ | ----------------------------------- | -------------------------- |
| Phase 2 (Winback)    | 跳过   | 重新调用 cloud-mapping[-intl] 字典  | 从 phase2.md 删除该 row_id |
| Phase 2.5 (规范化)   | 跳过   | 重新规范化（cn 调脚本 / intl 透传） | 从 phase2_5.md 删除        |
| Phase 2.6 (选品意图) | 跳过   | 重新判 has_spec + 触发追问          | 从 phase2_6.md 删除        |
| Phase 3 (搜索)       | 跳过   | 重新调用 product batch-search       | 从 phase3 产物移除         |
| Phase 4 (映射确认)   | 跳过   | 在映射表中重新展示该行              | 从映射表移除               |
| Phase 5 (写入)       | 跳过   | row update / row add 该行 SPU       | row rm 该行 SPU            |

### 完成回写

每个 Phase 完成 dirty 行处理后，**必须**回写 phase1.md：

```
1. 把 r003 status: dirty → stable
2. update_history 加一条 downstream_synced:r003 from <phase>
```

⚠️ **注意**：回写 phase1.md 不算违反不可逆原则——只更新状态字段，不重跑 Phase 1 算法。

---

## 与单次执行原则的关系

| 行为                               | 是否违反                        |
| ---------------------------------- | ------------------------------- |
| 重跑 Phase 1 全部算法              | ✅ 违反（不允许）               |
| 局部更新单行（dirty）              | ❌ 不违反（设计内例外）         |
| 下游 Phase 回写 phase1.md 状态字段 | ❌ 不违反（不动算法，只动状态） |
| Phase 4 想看 phase1.md 的 约束条件 | ❌ 不违反（读文件允许）         |
| Phase 4 重新执行 Phase 1 阶段 A.2  | ✅ 违反（绝对禁止）             |

**判据**：

- 是否重新执行了 Phase 1 算法（A / B / C 阶段）？是 → 违反
- 是否重新触发了 D 阶段追问？是 → 违反（除非局部更新对 dirty 行的小规模追问）
- 仅更新状态字段？否 → 安全
- 仅读取 phase1.md？否 → 安全

---

## 反模式

### ❌ 反模式 1：用户改一行，AI 整张表重跑

```
错：用户说"数据盘改 500GB"，AI 把 phase1.md 整个删掉重新跑 Phase 1 全流程
对：AI 只把 r003 标 dirty，update_history 加一条 modify，其他行不动
```

### ❌ 反模式 2：dirty 行没回写 stable

```
错：Phase 5 完成 r003 写入后没回写 phase1.md，导致下次启动 Phase 还会重跑 r003
对：Phase 5 写入完成 + save 成功 → 立即回写 phase1.md status = stable
```

### ❌ 反模式 3：复用 removed 的 row_id

```
错：r002 被删除后，新追加的行用 r002
对：永远从 max(row_id) + 1 开始分配
```

### ❌ 反模式 4：跨 phase 文件丢失 row_id

```
错：phase2_5.md 没有 row_id 列，下游不知道哪行对应哪行
对：所有 phase*.md 必须保留 row_id 列作为接力链锚点
```

### ❌ 反模式 5：站点切换走局部更新

```
错：用户说"我要改成国内站"，AI 只改 phase1.md 首行 site 标记
对：site 切换影响所有字典 / 所有 token 分类 → 必须重启 Phase 1（init 一条新的 update_history）
```

---

## v1 范围

v1 落地（本 PRD 范围）：

- ✅ row_id / status 字段加入 phase1.md
- ✅ update_history 字段加入 phase1.md
- ✅ 局部更新的自然语言触发 + 确认追问
- ✅ check-phase1.mjs 校验状态机一致性
- ✅ Phase 2.5 / 2.6 加 row_id 列透传

v1 暂不交付（后续优化）：

- ⏳ 下游 Phase 自动级联重跑的脚本化（v1 仍由 AI 按规则执行）
- ⏳ Phase 5 完成后的自动回写（v1 由 AI 提醒 + 人工确认）
- ⏳ removed 行的 sweep 调度（v1 手工触发）
