# Authentication 子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### table-permission-check

- **目录**: `Authentication/table-permission-check/`
- **触发场景**: 检查用户对数据表的访问权限（select/update/alter/create），支持单条和批量检查，支持多集群和多 BG。
- **触发关键词**: 权限检查、库表权限、tauth、select权限、update权限、alter权限、create权限、批量权限检查
- **不触发场景**: 申请新权限（应通过权限管理平台）；修改其他用户权限（需管理员操作）
- **包含资源**:
  - 详见子 Skill SKILL.md
