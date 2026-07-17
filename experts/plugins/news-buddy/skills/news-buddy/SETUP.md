# AI新闻搭子 — 首次部署指引

> **本文件仅在首次安装部署时读取。** 部署完成后（`.cache/.setup_done` 标记文件存在时），skill 运行时不会再加载本文件内容，以节省 token 和响应时间。

---

## 部署前置条件

### 1. tencent-news-cli 安装

tencent-news-cli 是腾讯新闻的命令行查询工具，是本 skill 的**第一优先数据源**。如果未安装，skill 会 fallback 到纯 web_search 模式（可用，但信源质量和时效性会降级）。

#### 检测是否已安装

```bash
which tencent-news-cli && tencent-news-cli version
```

- 如果输出路径和版本信息 → 已安装，跳到「配置 API Key」
- 如果输出 `not found` → 需要安装

#### 安装步骤

提供三种安装方式，任选其一：

> ⚠️ **安全提示：** 下方方式一/方式二是"下载脚本后直接执行"。出于安全考虑，**建议先下载脚本、检查内容（或核对哈希）再执行**，不要盲目把远程脚本直接管道给 `sh`/`iex`。若不确定，优先用方式三（NPM）并锁定版本号。

**方式一：macOS / Linux（推荐，先校验再执行）**

```bash
# 1) 下载脚本到本地
curl -fsSL https://mat1.gtimg.com/qqcdn/qqnews/cli/hub/tencent-news/setup.sh -o /tmp/tnc-setup.sh
# 2) 查看哈希 / 通读脚本内容，确认无误
shasum -a 256 /tmp/tnc-setup.sh
# less /tmp/tnc-setup.sh
# 3) 确认后再执行
sh /tmp/tnc-setup.sh
```

> 如确需一行式快捷安装（自行承担风险）：`curl -fsSL <URL> | sh`

**方式二：Windows（PowerShell，先校验再执行）**

```powershell
# 1) 下载脚本到本地
Invoke-WebRequest https://mat1.gtimg.com/qqcdn/qqnews/cli/hub/tencent-news/setup.ps1 -OutFile $env:TEMP\tnc-setup.ps1
# 2) 查看哈希 / 通读脚本内容
Get-FileHash $env:TEMP\tnc-setup.ps1 -Algorithm SHA256
# 3) 确认后再执行
& $env:TEMP\tnc-setup.ps1
```

**方式三：NPM（跨平台，推荐，锁定版本号）**

```bash
# 锁定具体版本，避免 latest 带来的供应链不确定性（请替换为实际发布版本）
npm i @tencentnews/cli@1.0.0 -g
# 如需最新版，自行确认后再用：npm i @tencentnews/cli@latest -g
```

安装完成后验证：

```bash
tencent-news-cli version
```

#### 配置 API Key

安装完成后需要配置 API Key 才能正常使用：

```bash
tencent-news-cli apikey-set <你的API_KEY>
```

**如何获取 API Key：**

1. 访问 [腾讯新闻 Skills 页面](https://news.qq.com/exchange?scene=appkey)
2. 登录腾讯账号
3. 点击「生成 API Key」按钮（每个账号仅支持生成一个）
4. 复制生成的 Key，在终端中执行上述 `apikey-set` 命令完成配置

> **注意事项：**
> - API Key 用于接口鉴权，请妥善保管，切勿泄露给他人
> - 每个账号仅支持生成一个 API Key

> 如果用户暂时没有 API Key，告知用户：
> - skill 可以正常使用，会自动 fallback 到 web_search 模式
> - 有了 API Key 后随时运行 `tencent-news-cli apikey-set <KEY>` 即可启用
> - 启用后新闻质量和时效性会显著提升（T1 级可信源 + 编辑把关内容）

#### 验证安装成功

```bash
# 快速验证（应返回热点新闻列表）
tencent-news-cli hot --caller news-buddy
```

如果返回正常的新闻列表，说明安装和配置都已完成。

---

### 2. Node.js 环境

skill 的画像管理脚本需要 Node.js 运行时：

```bash
node --version  # 需要 v16+
```

如果未安装 Node.js，参考 https://nodejs.org/ 安装 LTS 版本。

---

### 3. Skill 依赖安装

```bash
cd {SKILL_DIR} && npm install
```

---

## 部署完成标记

当以上所有步骤完成后，创建标记文件：

```bash
# macOS / Linux：
mkdir -p {SKILL_DIR}/.cache && touch {SKILL_DIR}/.cache/.setup_done
# Windows PowerShell：
#   New-Item -ItemType Directory -Force {SKILL_DIR}\.cache | Out-Null
#   New-Item -ItemType File -Force {SKILL_DIR}\.cache\.setup_done | Out-Null
```

**一旦此标记文件存在，后续 skill 运行时不再读取本 SETUP.md 文件。**

---

## 故障排查

| 问题 | 排查步骤 |
|------|----------|
| `tencent-news-cli: command not found` | 检查 PATH 是否包含安装目录，尝试重开终端；或尝试 NPM 方式重装：`npm i @tencentnews/cli@latest -g` |
| `apikey not configured` | 运行 `tencent-news-cli apikey-set <KEY>`，Key 从 https://news.qq.com/exchange?scene=appkey 获取 |
| `401 Unauthorized` | API Key 无效或过期，前往 https://news.qq.com/exchange?scene=appkey 重新生成 |
| `node: command not found` | 安装 Node.js v16+ |
| `npm install` 报错 | 检查网络连接，尝试 `npm install --registry=https://registry.npmmirror.com` |

---

## 部署后行为

部署完成后，SKILL.md 中的主流程会按以下逻辑处理 tencent-news-cli 可用性：

```
if (tencent-news-cli 可用且 API Key 已配置) {
    → 使用 tencent-news-cli 作为第一数据源（T1）
    → web_search 作为补充
} else {
    → 纯 web_search 模式（仍然执行信源四级过滤）
    → 每次推送时附一句提醒："安装 tencent-news-cli 可获得更优质的新闻源"
}
```
