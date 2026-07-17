#!/usr/bin/env python3
"""
腾讯云智能顾问角色配置向导 (Python 版)
自动检测账号信息和可用角色，引导用户完成配置

用法:
    python3 setup_role.py

环境变量（必须提前设置）:
    TENCENTCLOUD_SECRET_ID   - 腾讯云 SecretId（必填）
    TENCENTCLOUD_SECRET_KEY  - 腾讯云 SecretKey（必填）

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


# ============== 颜色输出（跨平台） ==============
def _supports_color() -> bool:
    """检测终端是否支持 ANSI 颜色"""
    if platform.system() == "Windows":
        # Windows 10+ 的 cmd/PowerShell 支持 ANSI（需 VT100）
        try:
            os.system("")  # 激活 VT100 模式
            return True
        except Exception:
            return False
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


USE_COLOR = _supports_color()


def _c(code: str, text: str) -> str:
    """带颜色格式化"""
    if USE_COLOR:
        return f"\033[{code}m{text}\033[0m"
    return text


def blue(text: str) -> str:
    return _c("0;34", text)


def green(text: str) -> str:
    return _c("0;32", text)


def yellow(text: str) -> str:
    return _c("1;33", text)


def red(text: str) -> str:
    return _c("0;31", text)


def bold_cyan(text: str) -> str:
    return _c("1;36", text)


def bold_yellow(text: str) -> str:
    return _c("1;33", text)


# ============== 输出辅助 ==============
def print_header(title: str):
    print("")
    bar = blue("=" * 58)
    print(bar)
    print(blue(f"  {title}"))
    print(bar)
    print("")


def print_step(msg: str):
    print(green(f"▶ {msg}"))


def print_ok(msg: str):
    print(green(f"✓ {msg}"))


def print_fail(msg: str):
    print(red(f"✗ {msg}"))


def print_warn(msg: str):
    print(yellow(f"⚠ {msg}"))


# ============== 配置保存 ==============
def save_config(account_uin: str, role_name: str, role_arn: str,
                auto_created: bool = False):
    """保存配置文件（跨平台兼容）"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    if platform.system() != "Windows":
        try:
            os.chmod(str(CONFIG_DIR), stat.S_IRWXU)  # 700
        except OSError:
            pass

    config = {
        "accountUin": account_uin,
        "roleName": role_name,
        "roleArn": role_arn,
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


def print_config_summary(account_uin: str, role_name: str, role_arn: str):
    """打印配置摘要"""
    print("")
    print_header("配置完成")
    print("")
    print(green("✓ 您已成功配置 tencent-cloudq!"))
    print("")
    print("配置摘要:")
    print("━" * 50)
    print(f"  账号 UIN:  {account_uin}")
    print(f"  角色名称:  {role_name}")
    print(f"  角色 ARN:  {role_arn}")
    print(f"  关联策略:  {', '.join(POLICY_NAMES)}")
    print(f"  配置文件:  {CONFIG_FILE}")
    print("━" * 50)
    print("")


def test_role(scripts_dir: Path):
    """测试角色扮演"""
    import subprocess
    login_url_path = scripts_dir / "login_url.py"

    try:
        test_result = subprocess.run(
            [sys.executable, str(login_url_path),
             "https://console.cloud.tencent.com/advisor"],
            capture_output=True, text=True, timeout=30,
        )
        try:
            result_data = json.loads(test_result.stdout)
            return result_data.get("success", False), result_data
        except json.JSONDecodeError:
            return False, {"error": {"message": "返回格式异常"}}
    except Exception as e:
        return False, {"error": {"message": str(e)}}


def main():
    print_header("腾讯云智能顾问 - 角色配置向导")

    # ============== 步骤 1：验证密钥 ==============
    print_step("步骤 1/6: 验证 API 密钥配置...")
    print("")

    secret_id = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    secret_key = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")

    if not secret_id or not secret_key:
        print_fail("未检测到 API 密钥")
        print("")
        print("请先设置环境变量:")
        print('  export TENCENTCLOUD_SECRET_ID="your-secret-id"')
        print('  export TENCENTCLOUD_SECRET_KEY="your-secret-key"')
        print("")
        if platform.system() == "Windows":
            print("Windows PowerShell:")
            print('  $env:TENCENTCLOUD_SECRET_ID="your-secret-id"')
            print('  $env:TENCENTCLOUD_SECRET_KEY="your-secret-key"')
            print("")
        print("获取密钥: https://console.cloud.tencent.com/cam/capi")
        sys.exit(1)

    masked_id = f"{secret_id[:8]}****{secret_id[-4:]}" if len(secret_id) > 12 else "****"
    print_ok("API 密钥已配置")
    print(f"  Secret ID: {masked_id}")
    print("")

    # ============== 步骤 2：获取账号信息 ==============
    print_step("步骤 2/6: 获取账号信息...")
    print("")

    uin_result = call_api(
        "sts", "sts.tencentcloudapi.com",
        "GetCallerIdentity", "2018-08-13", {},
    )

    if not uin_result.get("success"):
        print_fail("获取账号信息失败")
        print("")
        error_msg = uin_result.get("error", {}).get("message", "未知错误")
        print(f"  错误详情: {error_msg}")
        sys.exit(1)

    account_uin = str(uin_result.get("data", {}).get("AccountId", ""))
    account_type = str(uin_result.get("data", {}).get("Type", ""))

    print_ok("账号信息获取成功")
    print(f"  账号 UIN: {account_uin}")
    print(f"  身份类型: {account_type}")
    print("")

    # ============== 步骤 3：获取角色列表 ==============
    print_step("步骤 3/6: 查询可用角色...")
    print("")

    role_list_result = call_api(
        "cam", "cam.tencentcloudapi.com",
        "DescribeRoleList", "2019-01-16",
        {"Page": 1, "Rp": 50},
    )

    if not role_list_result.get("success"):
        print_warn("无法获取角色列表")
        print("")
        print("  可能的原因:")
        print("    1. 您的账号没有 cam:DescribeRoleList 权限")
        print("    2. 网络连接问题")
        print("")
        error_msg = role_list_result.get("error", {}).get("message", "未知错误")
        print(f"  错误详情: {error_msg}")
        print("")
        print("  您可以手动配置角色:")
        print('    export TENCENTCLOUD_ROLE_NAME="您的角色名称"')
        print("")
        print("  查看可用角色: https://console.cloud.tencent.com/cam/role")
        sys.exit(1)

    total = role_list_result.get("data", {}).get("TotalNum", 0)
    role_list = role_list_result.get("data", {}).get("List", [])

    # 筛选支持控制台登录的用户自定义角色
    console_roles = [
        r for r in role_list
        if r.get("ConsoleLogin") == 1 and r.get("RoleType") == "user"
    ]

    # ============== 无可用角色 → 创建新角色 ==============
    if not console_roles:
        print_warn("未检测到可用于控制台登录的角色")
        print("")
        print(f"  当前账号共有 {total} 个角色，但没有支持控制台登录的用户自定义角色。")
        print("")
        print(yellow("⚡ 安全提示：以下操作将修改您的 CAM（访问管理）配置，请仔细确认："))
        print("")
        print("  将要执行的 IAM 操作：")
        print(f"    1. [cam:CreateRole] 创建 CAM 角色：{green(ROLE_NAME)}")
        print(f"    2. 信任策略：仅允许当前账号 ({account_uin}) 扮演此角色")
        print("    3. 启用控制台登录（用于生成免密登录链接）")
        for policy in POLICY_NAMES:
            print(f"    4. [cam:AttachRolePolicy] 关联策略：{green(policy)}")
        print("")
        print("  权限范围说明：")
        print("    - 该角色仅用于免密登录腾讯云控制台查看智能顾问信息")
        print("    - QcloudAdvisorFullAccess 策略仅授权访问智能顾问服务，不影响其他云资源")
        print("    - 您可随时在 CAM 控制台删除此角色: https://console.cloud.tencent.com/cam/role")
        print("")

        try:
            confirm = input(green("是否同意创建？[y/N]: ")).strip()
        except (EOFError, KeyboardInterrupt):
            confirm = ""

        if confirm.lower() not in ("y", "yes"):
            print("")
            print_warn("已取消。您也可以手动创建角色：")
            print("")
            print("  1. 打开 CAM 控制台: https://console.cloud.tencent.com/cam/role")
            print(f"  2. 新建角色 → 腾讯云账户 → 角色名: {ROLE_NAME}")
            print("  3. 勾选「允许当前角色访问控制台」")
            for policy in POLICY_NAMES:
                print(f"  4. 关联策略: {policy}")
            print("")
            sys.exit(1)

        print("")
        print_step(f"正在创建角色 {ROLE_NAME}...")
        print("")

        # 构造信任策略
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
                "RoleName": ROLE_NAME,
                "PolicyDocument": trust_policy,
                "ConsoleLogin": 1,
                "Description": "腾讯云智能顾问助手角色（由 tencent-cloudq skill 创建）",
            },
        )

        if not create_result.get("success"):
            err_msg = create_result.get("error", {}).get("message", "未知错误")
            print_fail(f"角色创建失败: {err_msg}")
            print("")
            print("  请手动创建角色: https://console.cloud.tencent.com/cam/role")
            sys.exit(1)

        role_id = str(create_result.get("data", {}).get("RoleId", "unknown"))
        print_ok(f"角色创建成功（RoleId: {role_id}）")

        # 关联策略
        for policy_name in POLICY_NAMES:
            print("")
            print_step(f"正在关联策略 {policy_name}...")
            print("")

            attach_result = call_api(
                "cam", "cam.tencentcloudapi.com",
                "AttachRolePolicy", "2019-01-16",
                {"AttachRoleName": ROLE_NAME, "PolicyName": policy_name},
            )

            if attach_result.get("success"):
                print_ok(f"策略 {policy_name} 关联成功")
            else:
                err_msg = attach_result.get("error", {}).get("message", "未知错误")
                print_warn(f"策略关联失败: {err_msg}")
                print(f"  请到 CAM 控制台手动关联策略：")
                print(f"  https://console.cloud.tencent.com/cam/role/detail?roleName={ROLE_NAME}")

        # 保存配置并测试
        selected_role = ROLE_NAME
        role_arn = f"qcs::cam::uin/{account_uin}:roleName/{selected_role}"

        print("")
        print_step("步骤 5/6: 保存配置文件")
        print("")

        save_config(account_uin, selected_role, role_arn, auto_created=True)

        print_ok("配置文件已保存")
        print(f"  路径: {CONFIG_FILE}")
        print("")

        print_step("步骤 6/6: 测试角色扮演")
        print("")

        success, result_data = test_role(SCRIPT_DIR)

        if success:
            print_ok("角色扮演测试成功")
            print_config_summary(account_uin, selected_role, role_arn)
        else:
            print_warn("角色扮演测试失败（角色可能需要几秒生效）")
            print("")
            err_msg = result_data.get("error", {}).get("message", "未知错误")
            print(f"  错误详情: {err_msg}")
            print("")
            print(f"  配置已保存，请稍后重试或运行: python3 {SCRIPT_DIR / 'setup_role.py'}")
        sys.exit(0)

    # ============== 有可用角色 → 显示列表让用户选择 ==============
    print_ok(f"检测到 {len(console_roles)} 个可用角色（共 {total} 个角色）")
    print("")

    # 步骤 4：显示角色列表
    print_step("步骤 4/6: 选择角色")
    print("")
    print("可用角色列表（仅显示支持控制台登录的用户角色）:")
    print("━" * 74)

    for idx, role in enumerate(console_roles, 1):
        name = role.get("RoleName", "未知")
        desc = role.get("Description", "无描述") or "无描述"
        add_time = role.get("AddTime", "")
        print(f"  {bold_yellow(f'{idx:2d}')}. {bold_cyan(f'{name:<25}')} 创建于 {add_time}")
        print(f"    └─ {desc}")
        print("")

    print("━" * 74)

    # 步骤 5：选择角色
    print("")
    try:
        choice_str = input(green(f"请输入角色序号 [1-{len(console_roles)}]: ")).strip()
    except (EOFError, KeyboardInterrupt):
        choice_str = ""

    try:
        choice = int(choice_str)
    except ValueError:
        print_fail(f"无效的选择: {choice_str}")
        sys.exit(1)

    if choice < 1 or choice > len(console_roles):
        print_fail(f"无效的选择: {choice}")
        sys.exit(1)

    selected = console_roles[choice - 1]
    selected_role = selected.get("RoleName", "")
    selected_desc = selected.get("Description", "无描述") or "无描述"

    print("")
    print_ok(f"已选择角色: {selected_role}")
    print(f"  描述: {selected_desc}")
    print("")

    # 步骤 6：保存配置
    print_step("步骤 5/6: 保存配置文件")
    print("")

    role_arn = f"qcs::cam::uin/{account_uin}:roleName/{selected_role}"
    save_config(account_uin, selected_role, role_arn, auto_created=False)

    print_ok("配置文件已保存")
    print(f"  路径: {CONFIG_FILE}")
    print("")

    # 步骤 7：测试配置
    print_step("步骤 6/6: 测试角色扮演")
    print("")

    success, result_data = test_role(SCRIPT_DIR)

    if success:
        print_ok("角色扮演测试成功")
        print_config_summary(account_uin, selected_role, role_arn)
        print("")
        print("现在您可以:")
        print("")
        print("  1. 查询架构列表")
        print(f"     python3 {SCRIPT_DIR / 'tcloud_api.py'} advisor advisor.tencentcloudapi.com \\")
        print('       DescribeArchList 2020-07-21 \'{"PageNumber":1,"PageSize":10}\'')
        print("")
        print("  2. 查询架构详情")
        print(f"     python3 {SCRIPT_DIR / 'tcloud_api.py'} advisor advisor.tencentcloudapi.com \\")
        print('       DescribeArch 2020-07-21 \'{"ArchId":"arch-xxx","Username":"user"}\'')
        print("")
        print("  3. 如需重新配置")
        print(f"     python3 {SCRIPT_DIR / 'setup_role.py'}")
        print("")
    else:
        print_fail("角色扮演测试失败")
        print("")
        err_msg = result_data.get("error", {}).get("message", "未知错误")
        print(f"  错误详情: {err_msg}")
        print("")
        print_warn("可能的原因:")
        print("  1. 您的账号没有 AssumeRole 权限")
        print("  2. 角色信任策略不允许您的账号扮演")
        print("  3. 角色已被删除或禁用")
        print("")
        print("  请检查角色配置:")
        print("  https://console.cloud.tencent.com/cam/role")
        print("")
        print("  您也可以尝试手动配置:")
        print('  export TENCENTCLOUD_ROLE_NAME="其他角色名称"')


if __name__ == "__main__":
    main()
