# base +selectStaffs

> **前置条件：** 先阅读 [`../../ihr-shared/SKILL.md`](../../ihr-shared/SKILL.md) 了解共享运行规则和 JSON 协议。

选人组件人员搜索，支持分页和按姓名模糊搜索。只读操作，不修改员工或组织数据。

当前动作入口：

```bash
ihr-cli base +selectStaffs
```

## 典型触发表达

以下问题通常应进入 `+selectStaffs`：

- 帮我搜一下叫张三的人
- 面谈对象里找一下李四
- 选人组件查一下王五
- 分页看一下可选人员

## 命令

```bash
# 姓名模糊搜索
ihr-cli base +selectStaffs --searchKeyword "张三"

# 指定分页
ihr-cli base +selectStaffs --searchKeyword "张三" --pageNo 1 --pageSize 10

# JSON 输入（调试用）
ihr-cli base +selectStaffs --json '{"searchKeyword":"张三","pageNo":1,"pageSize":10}'

# 写入输出文件
ihr-cli base +selectStaffs --searchKeyword "张三" --output-file /tmp/ihr_base_select_staffs.json
```

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--searchKeyword <text>` | 否 | 搜索关键词，当前主要支持姓名模糊搜索，如果用户没有给搜索词，或搜索词为空，返回所有候选可见人员 |
| `--pageNo <n>` | 否 | 页码，从 `1` 开始，默认 `1` |
| `--pageSize <n>` | 否 | 每页记录数，默认 `10`，最大 `100` |
| `--json <json>` | 否 | 直接传入 JSON 字符串，调试用，不能和分项参数混用 |
| `--stdin` | 否 | 从标准输入读取 JSON 字符串，调试用，不能和分项参数混用 |
| `--output-file <file>` | 否 | 将结果额外写入文件 |
| `--dry-run` | 否 | 只打印请求信息，不真正执行 |

## 核心约束

### 1. `searchKeyword` 是可选参数

当用户没有给搜索词，或搜索词为空时，本动作会按分页返回当前登录态可见人员候选。

### 2. 必须分页使用

`pageNo` 从 `1` 开始，`pageSize` 最大为 `100`。
如果用户没有指定分页，保留默认值 `pageNo=1`、`pageSize=10`。

### 3. 只做选人查询

本动作不负责员工档案编辑、组织关系维护、权限变更或面谈配置保存。拿到候选人员后，由上层业务动作决定如何使用 `id`。

### 4. 不要求手动传身份上下文

常规场景不需要手动传 `companyId`、`userId` 或 `staffId`。CLI 会复用当前 profile 登录态，服务端基于登录态判断可见人员范围。

### 5. JSON 输入只作为调试通道

优先使用分项参数。`--json` / `--stdin` 用于调试或复现请求，不能和分项参数混用。

## 路由规则

CLI 根据当前 profile 的 `baseUrl` 自动选择底层接口：

| 条件 | 接口 |
|------|------|
| `baseUrl` 包含 `worker100` | `/gateway/ai/conference/v1/toolStaff/select` |
| 其他情况 | `/gateway/component/api/v1/ai/conference/selectStaffs` |

## 输出结果

CLI 统一输出：

```json
{"success":true,"command":"selectStaffs","request":{},"response":{}}
```

业务字段从 `response.data` 读取，重点包括：

| 字段 | 说明 |
|------|------|
| `response.data.pageInfo` | 分页信息 |
| `response.data.pageInfo.pageNo` | 当前页码 |
| `response.data.pageInfo.pageSize` | 每页记录数 |
| `response.data.pageInfo.totalCount` | 总记录数，部分环境可能命名为 `total` |
| `response.data.pageInfo.totalPages` | 总页数 |
| `response.data.dataList[]` | 人员候选列表 |
| `response.data.dataList[].id` | 人员 ID |
| `response.data.dataList[].name` | 人员姓名 |
| `response.data.dataList[].avatarUrl` | 头像 URL，可能为空 |

## 如何使用结果

交互式场景中，优先展示 `name` 和必要的 `id`，再根据用户选择把 `id` 交给后续业务流程。
如果同名人员较多，应继续分页或补充搜索词，而不是凭名字自动选中。

## 常见错误与排查

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| `--pageNo 必须大于等于 1` | 页码小于 1 | 传入 `--pageNo 1` 或更大的整数 |
| `--pageSize 取值范围必须为 1-100` | 每页数量越界 | 传入 `1` 到 `100` 之间的整数 |
| 配置错误 | 尚未初始化 CLI 配置 | 先执行 `ihr-cli config init --base-url <url>` |
| 未登录 | 当前 profile 没有 token | 先执行 `ihr-cli auth login --api-token-stdin` |
| 网络请求失败 | 服务不可达 | 检查服务地址与网络连通性 |

## 提示

- 只需要按姓名找人时，优先传 `--searchKeyword`。
- 用户没有指定分页时，保留默认 `pageNo=1`、`pageSize=10`。
- 本动作依赖服务端当前登录态判断可见人员范围，不需要在常规场景中手动传 `companyId`、`userId` 或 `staffId`。
