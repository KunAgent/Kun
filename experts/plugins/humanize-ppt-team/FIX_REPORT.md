# humanize-ppt-team 修复说明

本次在缓存目录内完成以下修复：

- 补齐主理人 `团队协作机制（铁律）`：建立团队、调度成员、消息中转、成员结论为准。
- 补齐 5 条红线中的“禁止未完成前序阶段就跳到后续阶段”。
- 明确 `TeamCreate → Agent spawn → SendMessage 回传` 正式协作流程。
- 扩写 `displayDescription.zh` 到 40-50 字规范范围。
- 锁定 Lucide CDN 版本，移除 `@latest`。
- 移除示例中的 `curl | bash` 安装写法，改为可审计安装建议。
- `html-ppt/scripts/render.sh` 支持跨平台浏览器自动探测与 `CHROME` 环境变量覆盖。
- `frontend-slides/scripts/deploy.sh` 移除自动全局安装和交互式登录，改为提示用户手动登录后重跑。
- 新增根级 `README.md`，补齐团队总览、依赖矩阵、验证命令与失败降级说明。
- 删除非标准 `setting.json`，保留 `settings.json`。
- 删除 `skills/frontend-slides/plugins/` 嵌套副本，降低包体积和路由干扰。

复审结果：

- `review.py --source-type external`：结构层 BLOCKER = 0，结构层 SUGGESTION = 0。
- 安全启发式样本：`credential_blockers=[]`、`cdn_latest=[]`、`dangerous_shell=[]`。
