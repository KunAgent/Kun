# MigraQ WorkBuddy Agent Expert

MigraQ 是腾讯云迁移服务专家，面向跨云迁移场景提供资源扫描、规格对标、TCO 成本分析、迁移方案规划和迁移执行辅助能力。

## 目录结构

```text
.
├── .workbuddy-plugin/plugin.json
├── agents/migraq.md
├── avatars/expert.png
└── skills/migraq/
    ├── SKILL.md
    ├── scripts/
    ├── references/
    └── icons/
```

## 能力范围

- 跨云资源扫描与资源盘点
- AWS、阿里云、华为云、GCP、Azure 等源云资源迁移咨询
- 腾讯云规格对标与选型推荐
- TCO 成本分析与迁移费用测算
- 迁移方案规划与服务包评估
- 迁移执行、集群管理等鉴权流程辅助

## 环境要求

| 项 | 要求 |
|---|---|
| Python | ≥ 3.7（脚本运行时会自检，低于此版本会以返回码 1 退出） |
| 强制 pip 依赖 | 无。脚本仅使用 Python 标准库 |
| 可选依赖 | `certifi`（强化 HTTPS 证书验证，缺失时自动回退到系统 CA） |

可选安装：

```bash
pip install certifi
```

## 鉴权说明

售前咨询、资源评估、规格推荐和 TCO 分析默认走免鉴权流程，无需 AK/SK。

当用户需要执行迁移、管理迁移集群、查询真实账号资源或创建/修改/删除云资源时，需要配置：

- `TENCENTCLOUD_SECRET_ID`
- `TENCENTCLOUD_SECRET_KEY`

密钥仅通过环境变量读取，不写入文件或日志。

## 打包

```bash
./build_expert_zip.sh
```

输出文件：`migraq-expert.zip`。
