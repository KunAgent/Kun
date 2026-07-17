# CloudQ Requirements

## 1. 必需依赖

### Python
- `python3`
- 最低版本：**Python 3.7+**

### Python 包
- `certifi`

安装命令：

```bash
pip install certifi
```

## 2. 可选依赖

以下依赖不是 CloudQ 核心功能的硬依赖，但会影响部分辅助能力：

### Python 包
- `requests`
  - 用途：用于 `check_env.py` 中的版本检查
  - 未安装时：通常不影响 CloudQ 核心对话与鉴权能力，但可能影响远端版本信息获取

安装命令：

```bash
pip install requests
```

### 外部命令
- `clawhub`
  - 用途：版本检查的备用路径
  - 未安装时：不影响 CloudQ 核心功能

## 3. 非包依赖的外部前置条件

以下内容不是 `pip` 依赖，但缺少时同样可能导致任务失败：

### 网络访问
CloudQ 运行时需要访问以下网络资源：
- `https://*.tencentcloudapi.com`
- `https://cloud.tencent.com`
- `https://clawhub.ai`
- `https://cloudq.cloud.tencent.com`

### 腾讯云凭证
CloudQ 需要以下两种方式之一完成鉴权：

#### 方式一：AK/SK 环境变量
- `TENCENTCLOUD_SECRET_ID`
- `TENCENTCLOUD_SECRET_KEY`
- 可选：`TENCENTCLOUD_TOKEN`

#### 方式二：OAuth 浏览器授权
- 通过 `scripts/login.py` 获取并保存 OAuth 凭证
- 本地会写入：`~/.tencent-cloudq/credential.json`

### 智能顾问服务开通
CloudQ 的核心能力依赖腾讯云智能顾问服务。
如果账号尚未开通智能顾问，即使 Python 依赖都已安装，核心功能仍然无法正常使用。

## 4. 建议安装方式

推荐至少执行：

```bash
python3 --version
pip install certifi requests
```

如果你希望只安装最小必需集，则执行：

```bash
pip install certifi
```

## 5. 常见失败原因

### 会直接导致失败
- 未安装 `python3`
- Python 版本低于 3.7
- 未安装 `certifi`
- 未配置有效腾讯云凭证
- 网络无法访问腾讯云相关接口
- 当前账号未开通智能顾问服务

### 一般不会阻塞核心功能
- 未安装 `requests`
- 未安装 `clawhub`

这两项通常只会影响版本检查，不会直接阻塞 CloudQ 的核心对话能力。

## 6. 最小可用结论

如果目标只是让 CloudQ 的核心能力可运行，至少需要满足：
- 已安装 `python3`，且版本为 **3.7+**
- 已安装 Python 包：`certifi`
- 已具备可用的腾讯云凭证
- 当前网络可访问腾讯云接口
- 当前账号已开通智能顾问服务
