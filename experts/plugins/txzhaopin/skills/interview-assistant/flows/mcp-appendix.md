# 面试助手 · MCP 调用技术附录（场景 T/A/C C-0 实现参考）

> 子模块路径：`flows/mcp-appendix.md`  
> 触发：在主 SKILL.md 的 Router-0 命中本类目后，**第一件事是 Read 本文件**，再执行内部步骤。  
> 本文件由 v3.6 单文件 SKILL.md 拆分而来，原章节内容完整保留。

---

## MCP 调用技术细节（场景 T / 场景 A / 场景 C C-0 的实现参考）

### 何时直接用 `execute_command`，何时用 `mcporter_call.py`

| 场景 | params 是否含 `|` | 平台 | 推荐方式 |
|------|-----------------|------|---------|
| `get_campus_interview_todo_list`（场景 T 待办） | 否 | 全平台 | ✅ 直接 `execute_command` 调 `mcporter call` |
| `post_v1_evaluation_todoList`（场景 T2 推荐待办） | 否 | 全平台 | ✅ 直接 `execute_command` 调 `mcporter call`；若环境有 recruit-mcp 专用工具，按平台规范完成能力检索后调用 |
| `getResumeByRId`（场景 C 拉简历） | 否（只有 rid） | 全平台 | ✅ 直接 `execute_command` 调 `mcporter call` |
| `getTagList` / `getStationList` 等字典接口 | 否 | 全平台 | ✅ 直接 `execute_command` |
| `post_v1_resume_search`（场景 A 搜索） | 否（keyword 是纯文字） | 全平台 | 直接 `execute_command` 也可 |
| `post_v1_resume_search`（keyword 含 `|`） | 是 | Windows | 🔴 **必须用** `scripts/mcporter_call.py` |
| `post_v1_resume_search`（keyword 含 `|`） | 是 | macOS/Linux | 推荐用脚本保持一致（直接 shell 也可） |
| 简历收藏 / 锁定 | 否 | 全平台 | ✅ 直接 `execute_command` |

### 使用 `scripts/mcporter_call.py` 的标准流程

```bash
# 1. 拿到 mcporter 路径
which mcporter          # macOS/Linux
where mcporter          # Windows

# 2. 把 params 写入 params.json（避免命令行传参被截断）
cat > $TMP_DIR/params.json <<'EOF'
{"keyword":"后台开发|后端开发|服务端","schoolLevel":["985"],"pageNum":1,"pageSize":30}
EOF

# 3. 调脚本（脚本内部会自动 cd 到 Workspace 根目录，以便加载 Project config）
python3 /path/to/interview-assistant/scripts/mcporter_call.py \
  "<mcporter_path>" recruit-mcp CallAPI \
  recruit.campus-resume-search.post_v1_resume_search \
  $TMP_DIR/params.json $TMP_DIR/result.jsonl

# 4. 读取结果（JSONL 格式）
# 第 1 行是 {"_meta": {"total": N, "status": 0, ...}}
# 后续每行一条简历 JSON
```

### 鉴权异常排查速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `mcporter list` 不显示 recruit-mcp | 配置未生效或 `cwd` 不对 | 执行 `mcporter config doctor` 看它实际加载了哪两个配置 |
| 返回 `401 Unauthorized` | 太湖 Token 过期 | 重跑 `tai-oauth` 脚本 或 到 https://tai.it.woa.com/user/pat 重新创建 PAT，再 `mcporter config add` 覆盖一次 |
| 返回 `403` | 招聘平台业务权限不足（非 token 问题；如缺面试官权限）| 到 hrright.woa.com 申请对应权限；🆕 连接已只认太湖授权，无需再申请「招活 Token」 |
| 返回 `Unknown MCP server 'recruit-mcp'` | subprocess cwd 错 | 脚本内部已修复；如仍报错，设置环境变量 `MCPORTER_WORKSPACE=<包含 config/mcporter.json 的目录>` |
