#!/usr/bin/env python3
import asyncio
import json
import os
import sys
import base

SCRIPT_DIR = base.scripts_dir()
sys.path.insert(0, SCRIPT_DIR)

def _check_tccli():
    if not base.tccli():
        return "not_installed"
    cred_path = os.path.join(base.real_home(), ".tccli", "default.credential")
    if os.path.exists(cred_path):
        try:
            with open(cred_path) as f:
                data = json.load(f)
            if data.get("secretId") and data.get("secretKey"):
                return "ok"
        except Exception:
            pass
        return "no_credentials"
    return "no_credentials"

def _ensure_installed():
    """未安装时自动 `pip install tccli`；返回 (status, message, auto_installed)。

    成功后重新走 _check_tccli 给出 ok / no_credentials；失败回退到 not_installed
    并附带失败原因，由调用方向用户转述手动安装指引。auto_installed 标记本次是否
    触发了自动安装（无论成败），供就绪提示区分"原本就在"与"刚自动装好"。
    """
    if base.tccli():
        return _check_tccli(), "", False
    ok, msg = base.ensure_tccli_installed()
    if not ok:
        return "not_installed", msg, True
    return _check_tccli(), "", True

def _get_version():
    try:
        import importlib.metadata
        return importlib.metadata.version("tccli")
    except Exception:
        return "unknown"

def _get_region():
    conf_path = os.path.join(base.real_home(), ".tccli", "default.configure")
    if os.path.exists(conf_path):
        try:
            with open(conf_path) as f:
                data = json.load(f)
                r = data.get("_sys_param", {}).get("region") or data.get("region")
                if isinstance(r, str):
                    return r
        except Exception:
            pass
    return "unknown"

async def main():
    status, install_msg, auto_installed = _ensure_installed()
    if status == "not_installed":
        reason = f"\n自动安装失败：{install_msg}" if install_msg else ""
        print(f"""[环境检查结果] tccli 未安装。
已尝试自动执行 `pip install tccli` 但未能完成安装。{reason}
请立即告知用户：tccli 命令行工具未安装，无法执行任何腾讯云安全产品操作。
请引导用户手动执行以下命令安装：
  pip install tccli
安装完成后还需要配置认证信息：
  tccli configure
【OAuth 登录】若用户希望通过 OAuth 方式登录（而非配置 AK），可告知用户回复"继续使用 OAuth 权限"，由专家执行 `${CODEBUDDY_PLUGIN_ROOT}/skills/tc-sec/scripts/tccli_auth_login.py`。
【授权建议】以上两种认证方式均须遵守：鉴于云安全专家基于大模型技术驱动其能力，建议为其单独分配专用访问密钥（AK）或 OAuth 子账号，并实施精细化权限控制。在无特殊业务需求的情况下，建议仅授予只读权限，避免配置高权限授权方式。**特别注意：OAuth 登录默认继承当前登录账号的全部权限，权限范围通常较高。**
在用户完成安装和配置前，不要尝试执行任何 tccli 命令。""")
        return
    if status == "no_credentials":
        print("""[环境检查结果] tccli 已安装但认证信息未配置。
请立即告知用户：tccli 认证信息（SecretId/SecretKey）未配置，无法调用腾讯云 API。
向用户说明可在以下三种方式中任选其一完成配置：
  1) 自行在终端执行 `tccli configure` 手动填写；
  2) 回复"启动 AKSK 配置流程 / 我有 AKSK 想配置 / 用密钥配置"等意图，由专家执行 `${CODEBUDDY_PLUGIN_ROOT}/skills/tc-sec/scripts/tccli_aksk_configure.py` 在用户本机的 127.0.0.1 启动一个一次性本地 web 配置页面（带一次性 token、仅 loopback 可达、不写访问日志），自动打开浏览器供用户填写 SecretId/SecretKey/Region（默认 ap-guangzhou），脚本代为写入 ~/.tccli/，密钥全程不进入命令行参数、stdout 或日志；
  3) 回复"继续使用 OAuth 权限"，由专家执行 `${CODEBUDDY_PLUGIN_ROOT}/skills/tc-sec/scripts/tccli_auth_login.py` 走 OAuth 授权登录。
**安全须知（必须原话向用户强调）**：请绝对不要把 SecretId / SecretKey 任何字符发送到本对话输入框；专家不应、也不需要看到明文密钥。AKSK 仅可通过方式 1 的本地终端、或方式 2 弹出的本地浏览器页面录入。若用户选方式 2，专家收到指令后只负责拉起脚本，不会也不应索取密钥文本——若用户已经把 AKSK 粘贴在对话里，请提示用户立即撤回该消息并轮换该密钥。
若 AKSK 配置脚本因当前会话无法启动浏览器（远程 SSH/容器等）会把 URL 打到 stderr，用户可在本机浏览器手动打开（或通过 SSH 端口转发），10 分钟未提交将返回 status=timeout。
【授权建议】以上几种认证方式均须遵守：鉴于云安全专家基于大模型技术驱动其能力，建议为其单独分配专用访问密钥（AK）或 OAuth 子账号，并实施精细化权限控制。在无特殊业务需求的情况下，建议仅授予只读权限，避免配置高权限授权方式。**特别注意：OAuth 登录默认继承当前登录账号的全部权限，权限范围通常较高。**
在用户完成配置前，不要尝试执行任何 tccli 命令。""")
        return

    print(f"""[环境检查结果] tccli 环境就绪。
- tccli 版本: {_get_version()}
- 默认 Region: {_get_region()}
- 认证状态: 已配置{"（本次已自动执行 pip install tccli 完成安装）" if auto_installed else ""}""")

    from check_products_enabled import check_product_activated, _print_results
    products_result = await check_product_activated("all")
    if products_result:
        print("\n[产品开通状态]")
        _print_results(products_result)

    print("\n可以正常执行腾讯云安全产品的 tccli 命令（仅限已开通产品）。")

if __name__ == "__main__":
    asyncio.run(main())
