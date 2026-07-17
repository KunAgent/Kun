# 调研策略与关键词模板

## 1. 学术论文检索策略

### 核心搜索模式

```
# ArXiv（最新预印本，AI/CS领域必查）
site:arxiv.org <topic> survey
site:arxiv.org <technique> 2023 OR 2024

# 综述类（快速获取领域全貌）
"<problem area>" survey paper 2023
"<technique>" "systematic review"
"<topic>" "state of the art" review

# 引用量筛选（Google Scholar辅助）
<technique> highly cited paper
<problem> seminal paper
```

### 高价值来源

| 来源 | 适用领域 | 搜索入口 |
|------|---------|---------|
| ArXiv cs.* | CS全领域 | arxiv.org/search |
| ACM Digital Library | 系统/HCI/PL | dl.acm.org |
| IEEE Xplore | 系统/网络/嵌入式 | ieeexplore.ieee.org |
| VLDB/SIGMOD Proceedings | 数据库/存储 | vldb.org, sigmod.org |
| OSDI/SOSP/EuroSys | 分布式系统 | usenix.org |
| NeurIPS/ICML/ICLR | ML/AI | proceedings.mlr.press |
| CVPR/ICCV/ECCV | 计算机视觉 | openaccess.thecvf.com |

---

## 2. 工程博客检索策略

### 顶级工程博客（直接搜索）

```
# 国际
site:netflixtechblog.com <topic>
site:engineering.uber.com <topic>
site:engineering.fb.com <topic>
site:research.google <topic>
site:dropbox.tech <topic>
site:discord.com/blog <topic>
site:slack.engineering <topic>
site:stripe.com/blog/engineering <topic>

# 国内
site:tech.meituan.com <topic>
site:engineering.shopee.com <topic>
<topic> site:mp.weixin.qq.com 技术 架构
<topic> 字节跳动 技术博客
<topic> 阿里巴巴 技术分享
<topic> 腾讯技术工程
```

### 通用工程实践搜索

```
<problem> production experience
<technique> at scale lessons learned
<architecture> real world implementation
<problem> how we solved engineering blog
<topic> 实践 踩坑 方案 架构演进
```

---

## 3. 竞品方案检索策略

### 架构文档搜索

```
<product_name> architecture overview
<product_name> technical design
<product_name> whitepaper PDF
<product_name> system design
<feature> how <product_name> works

# 开源实现
<feature> github stars:>1000
<technique> awesome-<topic> github
<problem> open source solution comparison
```

### 云服务对比

```
AWS vs GCP vs Azure <feature>
<managed_service> comparison 2024
<feature> cloud native solution
```

---

## 4. 跨行业类比检索策略

### 问题→行业映射表

| 技术问题类型 | 可类比的行业/领域 |
|------------|----------------|
| 流量/负载均衡 | 交通工程、电网调度、航空管制 |
| 缓存/预取 | 供应链管理、图书馆分馆策略 |
| 一致性/共识 | 金融清算、法律合同、选举机制 |
| 排队/调度 | 银行柜台、医院急诊分诊、制造业排产 |
| 推荐/匹配 | 婚恋平台、人才市场、广告竞价 |
| 故障恢复 | 航空安全、核电应急、金融熔断 |
| 数据压缩 | 生物DNA编码、通信信道编码 |
| 安全认证 | 门禁系统、护照/签证体系 |

### 跨行业搜索模式

```
<abstract_problem> solution operations research
<generic_technique> applied in logistics/finance/manufacturing
<problem_analogy> optimization algorithm
cross-domain <technique> application
```

---

## 5. 评估维度权重模板

### 根据业务场景预设权重

**互联网 C 端高并发场景**
- 性能/吞吐量：高
- 可用性：高
- 延迟：高
- 开发速度：中
- 成本：中
- 一致性：低

**企业内部系统**
- 可靠性：高
- 易维护：高
- 一致性：高
- 性能：中
- 成本：高
- 开发速度：中

**AI/ML 平台**
- 可扩展性：高
- 灵活性：高
- 生态成熟度：高
- 性能：中
- 成本：高
- 易维护：中

**创业早期 MVP**
- 开发速度：高
- 成本：高
- 易维护：高
- 性能：低
- 可靠性：中
- 可扩展性：中

---

## 6. 报告质量 Checklist

调研结束后对照检查：

- [ ] 每个方案至少有 1 个真实来源（论文/博客/代码仓库）
- [ ] 包含至少 1 个非显而易见的跨行业类比
- [ ] 候选方案数量 ≥ 5，排除显然不适用后缩减至 Top 3
- [ ] 业务特征与评估权重一一对应，有逻辑支撑
- [ ] 两个推荐方案的适用条件互补（覆盖不同情境）
- [ ] 落地路径具体（不只是"可以用 X"，而是"第一步做什么"）
- [ ] 对已知局限诚实标注，不做过度承诺
