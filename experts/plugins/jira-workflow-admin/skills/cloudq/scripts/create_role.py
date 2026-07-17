#!/usr/bin/env python3
"""
腾讯云智能顾问 — CAM 角色创建脚本 (Python 版)

功能：创建 advisor 角色并关联 QcloudTAGFullAccess、QcloudAdvisorFullAccess 策略
注意：本脚本包含 IAM 写入操作（CreateRole、AttachRolePolicy），
      仅应在用户明确同意后执行，不可自动运行

用法:
    python3 create_role.py                  # 自动获取账号 UIN
    python3 create_role.py --uin 100001234  # 手动指定账号 UIN

返回码:
    0 - 角色创建成功，配置已保存
    1 - 参数错误
    2 - AK/SK 未配置或无效
    3 - 角色创建失败

输出: JSON 格式结果（供 AI 解析）

跨平台支持: Windows / Linux / macOS
"""

import json
import os
import platform
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path

# 导入 tcloud_api 模块
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from tcloud_api import call_api  # noqa: E402

# ============== 配置 ==============
CONFIG_DIR = Path.home() / ".tencent-cloudq"
CONFIG_FILE = CONFIG_DIR / "config.json"
ROLE_NAME = "advisor"
POLICY_NAMES = ["QcloudTAGFullAccess", "QcloudAdvisorFullAccess"]


def output_json(obj: dict) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


def output_success(role_arn: str, account_uin: str, role_id: str = "unknown") -> dict:
    return {
        "success": True,
        "action": "CreateAdvisorRole",
        "data": {
            "roleName": ROLE_NAME,
            "roleArn": role_arn,
            "roleId": role_id,
            "accountUin": account_uin,
            "policiesAttached": POLICY_NAMES,
            "consoleLogin": True,
            "configFile": str(CONFIG_FILE),
        },
    }


def output_error(code: str, message: str) -> dict:
    return {
        "success": False,
        "action": "CreateAdvisorRole",
        "error": {"code": code, "message": message},
    }


MAX_ROLE_NAME_ATTEMPTS = 20


def find_available_role_name() -> tuple:
    """查找可用的角色名称，支持递增命名。

    检查顺序: advisor → advisor1 → advisor2 → ...
    - 如果角色不存在 → 返回该名称（可创建）
    - 如果角色存在且 ConsoleLogin=1 → 返回该名称（已可用）
    - 如果角色存在但 ConsoleLogin=0 → 尝试下一个名称

    Returns:
        tuple: (role_name, existing_ok)
            role_name: 可用的角色名称，或 None（超过最大尝试次数）
            existing_ok: True 表示角色已存在且支持控制台登录（无需创建）
    """
    candidates = [ROLE_NAME] + [f"{ROLE_NAME}{i}" for i in range(1, MAX_ROLE_NAME_ATTEMPTS)]
    for name in candidates:
        result = call_api(
            "cam", "cam.tencentcloudapi.com",
            "GetRole", "2019-01-16",
            {"RoleName": name},
        )
        if not result.get("success"):
            return name, False
        if result.get("data", {}).get("ConsoleLogin", 0) == 1:
            return name, True
    return None, False


def save_config(account_uin: str, role_arn: str, role_id: str = "",
                auto_created: bool = True):
    """保存配置到文件"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    if platform.system() != "Windows":
        try:
            os.chmod(str(CONFIG_DIR), stat.S_IRWXU)  # 700
        except OSError:
            pass

    config = {
        "accountUin": account_uin,
        "roleName": ROLE_NAME,
        "roleArn": role_arn,
        "roleId": role_id,
        "configuredAt": datetime.now(timezone.utc).isoformat(),
        "autoCreated": auto_created,
        "version": "1.0",
    }

    CONFIG_FILE.write_text(
        json.dumps(config, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    if platform.system() != "Windows":
        try:
            os.chmod(str(CONFIG_FILE), stat.S_IRUSR | stat.S_IWUSR)  # 600
        except OSError:
            pass


def main():
    # ============== 参数解析 ==============
    account_uin = ""
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--uin" and i + 1 < len(args):
            account_uin = args[i + 1]
            i += 2
        else:
            print(output_json(output_error("InvalidParameter", f"未知参数: {args[i]}")))
            sys.exit(1)

    # ============== 1. 检查 AK/SK ==============
    secret_id = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    secret_key = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")

    if not secret_id or not secret_key:
        print(output_json(output_error(
            "MissingCredentials",
            "未配置 TENCENTCLOUD_SECRET_ID 或 TENCENTCLOUD_SECRET_KEY"
        )))
        sys.exit(2)

    # ============== 2. 获取账号 UIN ==============
    if not account_uin:
        uin_result = call_api(
            "sts", "sts.tencentcloudapi.com",
            "GetCallerIdentity", "2018-08-13", {},
        )
        account_uin = str(uin_result.get("data", {}).get("AccountId", ""))

        if not account_uin or account_uin in ("", "None", "null"):
            error_msg = uin_result.get("error", {}).get("message", "无法获取账号 UIN")
            print(output_json(output_error("GetCallerIdentityFailed", error_msg)))
            sys.exit(2)

    # ============== 3. 查找可用角色名称 ==============
    target_role, existing_ok = find_available_role_name()

    if target_role is None:
        print(output_json(output_error(
            "NoAvailableRoleName",
            "无法找到可用的角色名称（已尝试 advisor ~ advisor19），"
            "请到 CAM 控制台手动管理: https://console.cloud.tencent.com/cam/role"
        )))
        sys.exit(3)

    if existing_ok:
        # 角色已存在且支持控制台登录 → 直接保存配置
        role_check = call_api(
            "cam", "cam.tencentcloudapi.com",
            "GetRole", "2019-01-16",
            {"RoleName": target_role},
        )
        role_id = str(role_check.get("data", {}).get("RoleId", "unknown"))
        role_arn = f"qcs::cam::uin/{account_uin}:roleName/{target_role}"
        save_config(account_uin, role_arn, role_id, auto_created=False)
        result = output_success(role_arn, account_uin, role_id)
        result["data"]["roleName"] = target_role
        print(output_json(result))
        sys.exit(0)

    # ============== 4. 创建角色 ==============
    trust_policy = json.dumps({
        "version": "2.0",
        "statement": [{
            "action": "name/sts:AssumeRole",
            "effect": "allow",
            "principal": {
                "qcs": [f"qcs::cam::uin/{account_uin}:root"]
            }
        }]
    }, separators=(",", ":"))

    create_result = call_api(
        "cam", "cam.tencentcloudapi.com",
        "CreateRole", "2019-01-16",
        {
            "RoleName": target_role,
            "PolicyDocument": trust_policy,
            "ConsoleLogin": 1,
            "Description": "腾讯云智能顾问助手角色（由 tencent-cloudq skill 创建）",
        },
    )

    if not create_result.get("success"):
        err = create_result.get("error", {})
        print(output_json(output_error(
            err.get("code", "CreateRoleFailed"),
            f"角色 {target_role} 创建失败: {err.get('message', '未知错误')}"
        )))
        sys.exit(3)

    role_id = str(create_result.get("data", {}).get("RoleId", "unknown"))

    # ============== 5. 关联策略 ==============
    attach_warnings = []
    for policy_name in POLICY_NAMES:
        attach_result = call_api(
            "cam", "cam.tencentcloudapi.com",
            "AttachRolePolicy", "2019-01-16",
            {"AttachRoleName": target_role, "PolicyName": policy_name},
        )
        if not attach_result.get("success"):
            err_msg = attach_result.get("error", {}).get("message", "未知错误")
            attach_warnings.append(f"策略 {policy_name} 关联失败: {err_msg}")
            print(f"WARNING: {attach_warnings[-1]}", file=sys.stderr)

    # ============== 6. 保存配置 ==============
    role_arn = f"qcs::cam::uin/{account_uin}:roleName/{target_role}"
    save_config(account_uin, role_arn, role_id, auto_created=True)

    # ============== 7. 输出结果 ==============
    result = output_success(role_arn, account_uin, role_id)
    result["data"]["roleName"] = target_role
    if attach_warnings:
        result["data"]["warnings"] = attach_warnings
    print(output_json(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
