# 腾讯云产品图标索引

> **AI 生成架构图时无需读取本文件或分类文件。**
> 直接在节点 style 中写 `tcloud-icon:key` 占位符，生成后运行 `inject_icons.py` 自动注入。

---

## 产品 key 速查

| key | 显示名 | 分类 |
|-----|--------|------|
| `user` | 用户 | 外部 |
| `internet` | 互联网 | 外部 |
| `cdn` | CDN 内容分发 | 网络 |
| `clb` | CLB 负载均衡 | 网络 |
| `nat` | NAT 网关 | 网络 |
| `vpc` | VPC 私有网络 | 网络 |
| `direct_connect` | 专线接入 | 网络 |
| `eip` | 弹性公网 IP | 网络 |
| `waf` | WAF 应用防火墙 | 安全 |
| `ddos` | DDoS 防护 | 安全 |
| `cwp` | 主机安全 CWP | 安全 |
| `tcss` | 容器安全 TCSS | 安全 |
| `cvm` | CVM 云服务器 | 计算 |
| `lighthouse` | Lighthouse 轻量 | 计算 |
| `scf` | SCF 云函数 | 计算 |
| `tke` | TKE 容器服务 | 计算 |
| `as` | 弹性伸缩 AS | 计算 |
| `cos` | COS 对象存储 | 存储 |
| `cbs` | CBS 云硬盘 | 存储 |
| `cfs` | CFS 文件存储 | 存储 |
| `mysql` | TencentDB MySQL | 数据库 |
| `redis` | TencentDB Redis | 数据库 |
| `tdsql` | TDSQL 分布式DB | 数据库 |
| `mongodb` | TencentDB MongoDB | 数据库 |
| `cynosdb` | TDSQL-C | 数据库 |
| `apigw` | API 网关 | 中间件 |
| `ckafka` | CKafka 消息队列 | 中间件 |
| `tsf` | TSF 微服务平台 | 中间件 |
| `cm` | 云监控 | 监控 |
| `cls` | CLS 日志服务 | 监控 |
| `cat` | 云拨测 CAT | 监控 |
| `emr` | EMR 弹性 MapReduce | 大数据 |
| `es` | Elasticsearch | 大数据 |

---

## 更新图标库

```bash
python scripts/setup_icons.py
```
