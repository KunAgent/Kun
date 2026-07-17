# GitHub 检索策略库

> 5 大模式的具体查询模板（按 ROI 排序）

---

## 模式 A：按 Organization 挖团队（首选 P0）

### A.1 公司 Org 公开成员页

URL 模板：
```
https://github.com/orgs/{ORG_NAME}/people
```

中国主要公司 GitHub Org 索引：

| 公司 | 主 Org | 子 Org（按业务线） |
|------|--------|------------------|
| 腾讯 | `Tencent` | `TencentBlueKing` / `TencentARC` / `Hippy` / `tencent-ailab` |
| 阿里巴巴 | `alibaba` | `apache` / `mPaaS` |
| 蚂蚁集团 | `ant-design` | `alipay` / `sofastack` |
| 字节跳动 | `bytedance` | `volcengine` / `pingcap`（PingCAP 与字节有合作）|
| 百度 | `baidu` | `PaddlePaddle` / `apollo-platform` |
| 华为 | `huawei` | `openharmony` / `MindSporeAI` |
| 京东 | `jdcloud` | `jd-opensource` |
| 美团 | `Meituan-Dianping` | - |
| 小米 | `MiCode` | - |
| 滴滴 | `didi` | - |
| 商汤 | `open-mmlab` | （open-mmlab 是商汤背书的开源团队）|
| 上海AI Lab | `OpenGVLab` / `InternLM` | - |
| 智源 | `BAAI-LMG` | `FlagAI-Open` |

### A.2 Google Dorking 备选（找隐藏 Org）

```
site:github.com inurl:orgs "{Company}"
site:github.com "{Company} Inc" "joined"
"works at {Company}" site:github.com
```

### A.3 实战例子

挖 PingCAP（数据库公司）所有员工：
```
1. https://github.com/orgs/pingcap/people  → 公开 200+ 成员
2. site:github.com "@pingcap" "Software Engineer"
3. inurl:pingcap.com 邮箱 site:github.com → 找 commit 邮箱含 @pingcap.com 的
```

---

## 模式 B：按 Repo Top Contributors

### B.1 直接看 contributors 页

URL 模板：
```
https://github.com/{ORG}/{REPO}/graphs/contributors
```

例：
- PyTorch: `pytorch/pytorch/graphs/contributors`
- Kubernetes: `kubernetes/kubernetes/graphs/contributors`
- vLLM: `vllm-project/vllm/graphs/contributors`
- TensorFlow: `tensorflow/tensorflow/graphs/contributors`

### B.2 Google Dorking

```
site:github.com "{Repo Name}" "Top contributors"
site:github.com inurl:graphs/contributors "{Repo}"
```

### B.3 中国主流开源项目映射

| 项目 | Repo URL | 类型 |
|------|---------|------|
| TiDB | `pingcap/tidb` | 数据库 |
| Apache RocketMQ | `apache/rocketmq` | 阿里捐赠 MQ |
| Apache Dubbo | `apache/dubbo` | 阿里 RPC |
| Vue.js | `vuejs/vue` | 尤雨溪 |
| ECharts | `apache/echarts` | 百度可视化 |
| MNN | `alibaba/MNN` | 阿里端侧推理 |
| MMDetection | `open-mmlab/mmdetection` | 商汤检测 |
| InternLM | `InternLM/InternLM` | 上海AI Lab LLM |
| Hippy | `Tencent/Hippy` | 腾讯跨端 |
| Hunyuan-DiT | `Tencent/HunyuanDiT` | 腾讯文生图 |
| ChatGLM | `THUDM/ChatGLM-6B` | 智谱（清华系）|
| Qwen | `QwenLM/Qwen` | 阿里通义 |
| ByteCheckpoint | `bytedance/ByteCheckpoint` | 字节训练 |

---

## 模式 C：按语言/框架找顶级贡献者

### C.1 GitHub Search 公开 URL

```
# Rust 高手（500+ followers，中国地区）
https://github.com/search?q=language:rust+followers:>500+location:China&type=Users

# Go 高手
https://github.com/search?q=language:go+followers:>1000&type=Users

# AI/ML（Python + 大量 Star）
https://github.com/search?q=language:python+stars:>1000+location:Beijing&type=Users
```

### C.2 Google Dorking

```
site:github.com "Rust" location china followers
site:github.com "Senior Software Engineer" language python
"core contributor" "{Framework}" site:github.com
```

### C.3 框架专家定位表

| 技术栈 | 定位关键词 |
|-------|----------|
| 大模型训练 | `pytorch + distributed + trainer` |
| 大模型推理 | `vllm + llama.cpp + tensorrt-llm` |
| 编译器 | `LLVM + tvm + mlir` |
| 数据库 | `tikv + pingcap + sqlite` |
| Kubernetes | `k8s + kubelet + operator-sdk` |
| 自动驾驶 | `autoware + apollo + carla` |

---

## 模式 D：按 commit message 反查

### D.1 commit URL 解析

```
https://github.com/{org}/{repo}/commits?author={username}
https://api.github.com/repos/{org}/{repo}/commits?author={email}
```

### D.2 Google Dorking

```
site:github.com "Authored-by: {Name}"
site:github.com "Co-authored-by:" "{email}"
site:github.com "Signed-off-by: {Real Name}"
```

### D.3 用 commit 信息反查跳槽轨迹

某人的 commit 邮箱变化（公开 commit 可见 author email）：
- 2020-2022: commit 邮箱 = @bytedance.com → 在字节
- 2023-2024: commit 邮箱 = @meituan.com → 已跳美团
- 2025: commit 邮箱 = personal Gmail → 自由职业 / 创业

---

## 模式 E：按 Stars / Lists 关联挖掘

### E.1 已知专家 → 同领域挖人

```
1. 已知 A 是 LLM 推理专家（vLLM 核心贡献者）
2. 看 A 的 Followers（数千人）→ 多数是同领域
3. 看 A 的 Following（关注的人）→ 业界大佬
4. 看 A Star 的项目 → 兴趣方向
5. 看 A 创建的 Lists（GitHub Star Lists） → 系统性整理
```

### E.2 实操查询

```
https://github.com/{username}?tab=followers
https://github.com/{username}?tab=stars
https://github.com/{username}/lists
```

---

## 6 大查询模板（直接复用）

### Q1：挖某公司全体开源贡献者
```
search 1: https://github.com/orgs/{COMPANY}/people
search 2: site:github.com inurl:{COMPANY} "members"
search 3: "@{company-domain}" site:github.com
```

### Q2：找某 Repo 核心 maintainer
```
fetch 1: https://github.com/{ORG}/{REPO}/graphs/contributors
fetch 2: https://github.com/{ORG}/{REPO}/graphs/code-frequency
search 3: "{Repo}" "core maintainer" site:github.com
```

### Q3：找某语言/框架的中国专家
```
search 1: https://github.com/search?q=language:{LANG}+location:china+followers:>500&type=Users
search 2: site:github.com "{Lang}" "Senior" "Beijing OR Shanghai OR Shenzhen"
```

### Q4：验证候选人技术真实水平
```
fetch 1: https://github.com/{username}
fetch 2: https://github.com/{username}?tab=repositories&q=&type=public&language=&sort=stargazers
search 3: "{username}" commit history site:github.com
```

### Q5：从 commit 邮箱反查公司
```
search: "{full_name}" "@{company}.com" site:github.com
fetch:  https://github.com/search?q={email}+type:commits
```

### Q6：找某领域专家集群
```
fetch 1: https://github.com/{known_expert}?tab=followers  ← 同领域人
fetch 2: https://github.com/{known_expert}?tab=stars      ← 兴趣方向
```

---

## 边界场景与降级

| 场景 | 处理 |
|------|------|
| GitHub Org 是 private（看不到 members）| 跳到模式 D（commit 反查）|
| 用户隐藏 Activity（profile 一片空白）| 跳过该用户，confidence 标 low |
| Profile Company 字段过时（如还写"前 Twitter"）| 用最新 commit 邮箱判断现状 |
| 用户名是化名（无法关联真名）| 检查 Bio / Twitter / 个人主页交叉验证 |
| GitHub 反爬（需登录）| 用 web_search Google 缓存替代 |

---

## 与 LinkedIn 联动决策树

```
拿到一个 GitHub username 后 →
    │
    ├─ Profile 有 Company 字段（@company-mention）→ very_high，直接入库
    │
    ├─ Profile 有 Company 字段（free text）→ high，建议 LinkedIn 二次验证
    │
    ├─ Profile 无 Company 但 commit email 含 @company.com → high
    │
    └─ Profile 完全空白 → 跳 linkedin-deep-miner 用 username + 真名搜索
```
