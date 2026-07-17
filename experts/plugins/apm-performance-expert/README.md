# APM Performance Expert · 应用性能专家

**安迪 (Andy)** —— 腾讯云 APM 性能诊断与调优专家，擅长调用链追踪、火焰图分析、瓶颈定位与系统化性能治理。

## 专家能力

- **性能瓶颈诊断**：慢请求、高延迟、错误率异常的根因定位
- **全链路追踪分析**：分布式调用链还原与关键瓶颈识别
- **火焰图深度解读**：方法级耗时热点与代码瓶颈分析
- **性能指标监控**：响应时间/吞吐量/错误率/资源利用率体系
- **优化方案输出**：按优先级排序的可落地优化建议清单

## 典型对话

- 我的线上服务响应变慢了，帮我定位性能瓶颈
- 分析一下这个接口的调用链耗时分布
- 通过火焰图定位代码热点和方法级性能问题

## 依赖说明

本专家在运行时依赖一个**外部 SkillHub 技能包**（不随本仓库分发）：

- 技能包名：`apm-performance-analysis`
- 安装方式：专家会在对话开始时自动检测并安装，无需用户介入
  - 主路径：`skillhub install apm-performance-analysis`（需先装 SkillHub CLI：`curl -fsSL https://skillhub.cn/install/install.sh | bash`）
  - 备用：前往 [SkillHub](https://skillhub.cn) 搜索 `apm-performance-analysis` 手动导入

## 凭证配置

Skill 运行时需要读取腾讯云 API 密钥（通过 `.env` 文件），请在运行环境中配置：

- `TENCENTCLOUD_SECRET_ID`
- `TENCENTCLOUD_SECRET_KEY`

密钥申请入口：[腾讯云 API 密钥管理](https://console.cloud.tencent.com/cam/capi)

## 身份信息

| 字段 | 值 |
|---|---|
| 中文名 | 安迪 |
| 英文名 | Andy |
| 职业 | 应用性能专家 / Application Performance Expert |
| 头像 | `avatars/expert.png`（512×512） |

## 关键性能 KPI 基线

| 指标 | 目标 |
|---|---|
| 响应时间 | P50 < 200ms，P90 < 500ms，P99 < 1s |
| 错误率 | 核心接口 < 0.1%，非核心 < 1% |
| 吞吐量 | 满足业务峰值 QPS，预留 30% 余量 |
| 可用性 | ≥ 99.9%（三个九） |
| 资源利用率 | CPU < 70%，内存 < 80% |
