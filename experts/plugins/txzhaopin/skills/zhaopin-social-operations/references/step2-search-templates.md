# 阶段 2-3：多路检索参数 + 脚本搜索（v6.1.1）

## 设计思路

阶段 2 把画像翻译为多路检索参数，阶段 3 **运行 `social_search.py` 脚本**执行搜索（Python 直接 JSON-RPC 调 MCP）。

---

## 🆕 v6.1.1 新增：`mustCompanies` 强制下发

当 `profile.must.companies` 非空（用户明确说"只要 XX 公司的"），**必须**在 `common_params` 里加 `mustCompanies`（字符串数组）：

```json
{
  "common_params": {
    "location": ["深圳"],
    "mustCompanies": ["腾讯", "字节跳动"],
    ...
  },
  "routes": [...]
}
```

`social_search.py` 在加载时会：
1. 从 `common_params` 里 **pop 出 `mustCompanies`**（不作为搜索参数直接下发给 MCP）
2. 把它的值注入到**每条 route 的 `allCompany`**（与 route 原有 `allCompany` 并集去重）
3. 最终发给 MCP 的请求体里只有合法的 `allCompany` 字段

这样 MCP 后端会基于**简历全部工作经历**做命中（不是只看最近一家公司），避免误杀。

### 与公司锚定路的区别

- `common_params.mustCompanies`：**所有路**硬约束 AND 关系，用户刚需
- 公司锚定路（独立一路）的 `allCompany`：扩召回的 bonus 推荐清单

用户明指公司时，`mustCompanies` 下发到**所有路**（包括公司锚定路）；此时公司锚定路的 `allCompany` 会被 `mustCompanies` 收窄，这是符合预期的。

### 为什么需要这一步？

粗筛层只能看到 `lastEmployerName`（最近一家公司），无法判断"早年待过腾讯但最近跳到创业公司"的候选人是否符合。所以公司硬约束必须在**搜索端**就生效（通过 `allCompany`）；粗筛层在 v6.1.1 已同步删除 `must.companies` 硬过滤分支。

---

## 🆕 v6.1.0 重要升级

1. **城市字段双子请求**（方案 1）：当 `common_params.location` 非空时，脚本自动拆为"当前城市路 + 期望城市路"两个子请求做 OR 合并。用户/模型**不要手写** `expectLocation`，脚本会自动派生
2. **supportNoExpectCity 决策位**（方案 1）：用户在阶段 1 决定是否纳入"期望城市为空"的候选；该字段写入 `common_params` 后由脚本转发给期望城市子请求
3. **四维加权粗筛**（方案 2）：粗筛同时使用 `must`（硬过滤）+ `bonus`（加权加分），`bonus` 填写质量直接影响 Top 命中率，详见 step4-rough-read-fields.md
4. **公司锚定路**（方案 3）：泛行业场景（游戏/直播/金融/电商/医疗/汽车/教育）必须加一路 `allCompany` 含 10-20 家领头公司

---

## 🔴 核心约束

1. **筛选项归筛选项，searchKey 归 searchKey**：
   - 能用结构化字段的（location/workYear/minDegree/positionTags/allCompany/skillTags）**必须**用结构化字段
   - 不能用结构化字段的（具体业务领域、项目细节）才用 `searchKey`
2. **searchKey 连接规则**：
   - 多个词用**空格**分隔
   - `searchKeyUseAnd`：true=AND，false=OR（默认 OR）
   - **AND 最多 2 个词**（社招底层搜索特性，AND 3 词以上经常 0 结果）
3. **每路都带 `locked: 0` 和独立 `diggerSearchId`**
4. **硬约束在所有路保持不变**（location / workYear / minDegree / schoolLevelTags / 用户明指的公司）
5. **加分条件不放进搜索参数**，留到粗筛/精读阶段判断

---

## 多路检索策略

取代旧版"严→中→松"3 轮模板，v4 采用**多角度互补**策略：每路 searchKey 从不同角度切入，结构化字段保持一致。

典型 3-4 路：

### 路径 1：岗位切入
- searchKey：岗位名 + 同义词（2-4 个词，OR）
- 目的：捞职位标题直接匹配的人

### 路径 2：经历切入
- searchKey：产品名 / 项目名 / 公司名（3-5 个词，OR）
- 目的：捞做过类似事情的人，即使职位名不同

### 路径 3：技术切入
- searchKey：底层技术栈 / 方法论 / 框架（3-5 个词，OR）
- 目的：捞技术匹配的人，覆盖跨行业背景

### 🆕 路径 4：公司锚定路（v6.1.0 · 泛行业场景强制）

**何时加**：当用户画像属于"标签泛、行业强"类（游戏/直播/金融/电商/医疗/汽车/教育/出海/文娱，或运营/产品/市场/BD/设计 + 明确行业），**必须加这一路**。

**参数规则**：
- `allCompany`：10-20 家领头公司（数组，OR 关系）
  - **🆕 v6.2.0 唯一来源**：原样复用 `profile.bonus.tier1_companies`（阶段 1 由 LLM 现场生成，作为会话内唯一公司清单源）
    - 实操：写 `search_params.json` 时，把 `profile.bonus.tier1_companies` 数组**整体拷贝**到该路的 `allCompany`，**不要重新组织清单**
    - 这一约束保证：粗筛维度 2 加权用的 tier1 公司 = 搜索召回时锚定的 tier1 公司，行业对口率指标可对齐
  - **若用户已在 `must.companies` 明指了公司 → 直接等于 `must.companies`，不扩展（红线）**
- `searchKey`：用岗位核心词（3-5 个，OR）
- `positionTags`：可放宽或不填（公司已锁行业）

**目的**：解决"标签对但行业跑偏"（例：游戏客户端搜索命中比亚迪 Linux 图形开发）。实测方案 3 让 Q1 从 22 → 85 召回，Top 10 的行业命中率从 30% → 80%。

**可根据需要增减到 2-5 路，每路必须有差异化 searchKey。**

---

## 参数结构（每路一个）

```json
{
  "diggerSearchId": "mcp-recruit-{UUID}",
  "locked": 0,
  "size": 20,
  "location": ["深圳"],
  "workYearStart": 5,
  "workYearEnd": 8,
  "minDegree": "本科",
  "positionTags": ["后台"],
  "searchKey": "分布式存储 对象存储 Ceph",
  "searchKeyUseAnd": false
}
```

---

## 参数合法性自检

| 检查项 | 标准 |
|---|---|
| searchKey 是否用了 AND？ | 只有精准路（≤2 词）可用 AND，其余用 OR |
| 加分条件有没有混进参数里？ | 不应有 |
| 每路 searchKey 是否有差异？ | 必须有 |
| 单路词数 | 2-6 个 |
| 岗位方向锚定 | 每路都要有 positionTags |
| allCompany | 必须是数组 `["网易","米哈游"]`，不能是逗号字符串 |
| positionTags | 合法枚举值（"后台"不是"后端开发"） |

---

## 搜索执行（阶段 3a · social_search.py）

模型根据画像生成 `search_params.json` 并落盘到当前 workspace，然后运行脚本：

```bash
cd {workspace} && python3 {skillDir}/scripts/social_search.py \
    --params search_params.json \
    --output candidates.jsonl
```

> ⚠️ **`--params` 必传**。不传脚本会立即报错并退出码 2，避免静默使用错误参数搜出无关简历。

脚本内部自动完成：
1. 加载并校验 `search_params.json`（routes 不能为空）
2. 把 `common_params` 合并到每个 route 的 params
3. 自动生成每路的 `diggerSearchId`（用户无需提供）
4. **v6.1.0 城市双子请求**：若 `location` 非空，每路拆为"当前城市路 + 期望城市路"并发查询后按 rid 合并（单路内）
5. N 路并发搜索（每路单页最多 30 条；含双子请求时单路上限约 60 条原始数据）
6. 按 `rid`（**小写**）跨路去重合并
7. `atsRights` 非空过滤
8. `slim_search_result()` 字段精简（统一输出**小写驼峰** key，与接口原始字段一致）
9. 落盘 JSONL

### search_params.json 模板（v6.1.1）

```json
{
  "common_params": {
    "location": ["深圳"],
    "supportNoExpectCity": false,
    "mustCompanies": ["腾讯", "字节跳动"],
    "workYearStart": 5,
    "workYearEnd": 8,
    "minDegree": "本科",
    "locked": 0,
    "size": 30,
    "from": 0
  },
  "routes": [
    {
      "name": "岗位切入",
      "params": {
        "positionTags": ["后台"],
        "searchKey": "存储 网盘 Ceph",
        "searchKeyUseAnd": false
      }
    },
    {
      "name": "经历切入",
      "params": {
        "positionTags": ["后台"],
        "searchKey": "对象存储 分布式存储",
        "searchKeyUseAnd": false
      }
    },
    {
      "name": "技术切入",
      "params": {
        "positionTags": ["后台"],
        "searchKey": "C++ Go 微服务 高并发",
        "searchKeyUseAnd": false
      }
    }
  ]
}
```

**字段说明**：
- `common_params`：所有路共享的硬约束（来自画像 `must`）+ 强制字段（`locked: 0`）+ 分页（`size`/`from`）
- `common_params.location`：目标城市。**脚本会自动派生 expectLocation 做双子请求**，用户/模型**不要手写 expectLocation**
- `common_params.supportNoExpectCity`（v6.1.0 可选）：当 `location` 非空时生效。`true` → 期望城市子请求会同时纳入"期望为空"的候选；`false`/不传 → 仅纳入明确期望=目标城市的
- `common_params.mustCompanies`（v6.1.1 可选）：用户明指公司（来自 `profile.must.companies`）。**仅写在 `common_params`，不要写到某条 route**；脚本自动注入每条 route 的 `allCompany`；本身不作为搜索参数直接下发给 MCP
- `routes`：多路检索（建议 2-5 路），每路只写差异化字段（`positionTags` / `searchKey` / `searchKeyUseAnd` / `skillTags` / `allCompany` 等）
- `diggerSearchId`：**不要写**，脚本自动生成

> ⚠️ **字段名踩坑**：搜索接口返回的字段全部是小写驼峰（`rid` 非 `Rid`，`totalCount` 非 `TotalNum`，`highLightOthers` 非 `OtherHighlight`）。`slim_search_result()` 已统一输出小写驼峰 key（与接口原始字段一致），无需大小写转换。

### 🆕 4 路模板示例（泛行业场景·含公司锚定路）

游戏客户端 Unity 场景：

```json
{
  "common_params": {
    "location": ["深圳"],
    "supportNoExpectCity": true,
    "workYearStart": 2,
    "workYearEnd": 99,
    "minDegree": "硕士",
    "schoolLevelTags": ["985", "211", "C9", "海外高校"],
    "locked": 0,
    "size": 30,
    "from": 0
  },
  "routes": [
    {
      "name": "精准标签+引擎切入",
      "params": {
        "positionTags": ["游戏客户端"],
        "searchKey": "Unity U3D 战斗系统 客户端架构 微信小游戏",
        "searchKeyUseAnd": false
      }
    },
    {
      "name": "宽标签+强游戏词",
      "params": {
        "positionTags": ["客户端", "前端"],
        "searchKey": "Unity 游戏客户端 战斗系统 小游戏 Cocos",
        "searchKeyUseAnd": false
      }
    },
    {
      "name": "技术词AND强收口",
      "params": {
        "positionTags": ["后台", "算法"],
        "searchKey": "Unity 游戏客户端",
        "searchKeyUseAnd": true
      }
    },
    {
      "name": "公司锚定路（v6.1.0）",
      "params": {
        "allCompany": [
          "腾讯", "网易", "米哈游", "莉莉丝", "朝夕光年",
          "字节跳动", "叠纸网络", "库洛游戏", "鹰角网络", "完美世界",
          "三七互娱", "B站", "沐瞳科技", "悠星网络", "光子游戏",
          "天美工作室", "心动网络", "IGG", "FunPlus", "元象科技"
        ],
        "searchKey": "Unity 游戏客户端 战斗系统 客户端架构",
        "searchKeyUseAnd": false
      }
    }
  ]
}
```


---

## 搜索结果处理（social_search.py 自动完成）

脚本自动将去重 + 过滤后的结果写成 JSONL 文件（每行一条精简后的简历），供 `rough_screen.py` 使用：

```
{"rid": "uuid1", "name": "张三", "workPlace": "深圳", "highLightOthers": [...], ...}
{"rid": "uuid2", "name": "李四", "workPlace": "深圳", ...}
...
```

> 注意：JSONL 中的 key 全部是**小写驼峰**，与接口原始字段保持一致；不再做大小写转换。完整字段列表见 `interfaces/search-social-resume.md`。

---

## 中间产物输出（展示给用户）

搜索完成后，输出摘要：

```
✅ N 路检索完成：
- 路径 1（岗位切入）：X 条
- 路径 2（经历切入）：X 条
- 路径 3（技术切入）：X 条
📊 合并去重：X 条 → 候选池 Y 条

🚪 闸门：候选池 Y < 20 ⚠️ 可能需要回阶段 1 调整画像
```

**候选池 < 20 时**：提示用户"检索召回不足，是否调整画像重新检索？"

---

## 💡 职级同义词扩展（内置常识）

用户提到职级时，可在 `searchKey` 中加入同级别同义词扩展召回：

| 用户说法 | 建议扩展（OR） |
|---|---|
| 初级 / junior | 初级 助理 专员 |
| 中级 / senior（中级语境） | 中级 高级 Senior |
| 资深 / 专家 / staff / principal | 资深 专家 Expert 首席 Principal Staff |
| 主管 / leader / TL | 主管 Leader 组长 Lead TL |
| 经理 / 总监 | 经理 Manager 总监 Director |

> 这些是腾讯社招简历库里常见的中英文表达。判断时灵活组合，不必全部塞入。
