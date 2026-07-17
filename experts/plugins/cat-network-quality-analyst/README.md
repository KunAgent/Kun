# CAT Network Quality Analyst · 网络质量分析专家

基于腾讯云 CAT（Cloud Automated Testing，云拨测）平台的网络质量分析专家，一键洞察全球网络健康状况。

## 专家能力

- **多维度性能分析**：可用性、响应时间、错误率等关键性能指标
- **异常与错误分布定位**：按地域、运营商、时间维度交叉分析
- **网络问题自动定界**：区分运营商链路异常与服务端自身问题
- **抓包智能诊断**：深度解析 TCP / TLS / DNS / HTTP 协议层问题
- **专业报告输出**：自动生成结构化 PDF 分析报告，含图表与可操作建议

## 典型对话

- 帮分析一下云拨测任务 task-xxxxxxxx 最近 24 小时的错误情况
- 生成这个拨测任务的整体分析报告
- 对指定错误记录做抓包深度分析

## 依赖说明

本专家在运行时依赖一个**外部 SkillHub 技能包**（不随本仓库分发）：

- 技能包名：`cat-network-quality-analysis-v1-0-1`
- 安装方式：专家会在首次需要时自动检测并安装，无需用户介入
  - 主路径：`npx skillhub install cat-network-quality-analysis-v1-0-1`
  - 备用：curl 下载 cos 包后解压到 `~/.workbuddy/skills/cat-network-quality-analysis`

## 凭证配置

分析执行需要读取腾讯云 API 密钥，**出于安全考虑禁止通过对话发送密钥**，请在终端自行配置以下任一组环境变量：

- `CAT_SECRET_ID` / `CAT_SECRET_KEY`
- `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`

密钥申请入口：[腾讯云 API 密钥管理](https://console.cloud.tencent.com/cam/capi)

配置详细指引请参见 agent prompt `agents/cat-network-quality-analyst.md` 中的「技能依赖 · Step 5 — 检查腾讯云凭证」部分。

## 报告命名规范

- 路径格式：`{task_id}/{task_id}_{report_type}_{timestamp}.pdf`
- `report_type` 取值：`error_report` / `overall_report` / `pcap_report`
- `timestamp` 格式：`YYYYMMDD_HHmmss`
