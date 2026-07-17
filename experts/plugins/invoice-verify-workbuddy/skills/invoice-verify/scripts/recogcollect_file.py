#!/usr/bin/env python3
"""识别本地发票源文件，并输出后续流程可直接消费的标准载荷。"""

import argparse
import base64
import json
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import call_mcp


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".pdf", ".ofd", ".xml"}
GENERIC_INVOICE_NAMES = {"", "增值税发票", "发票", "票据"}

INVOICE_TYPE_NAMES = {
    "01": "增值税专用发票",
    "03": "机动车销售统一发票",
    "04": "增值税普通发票",
    "08": "增值税电子专用发票",
    "10": "增值税电子普通发票",
    "11": "增值税普通发票（卷式）",
    "14": "增值税电子普通发票（通行费）",
    "15": "二手车销售统一发票",
    "31": "数电发票（增值税专用发票）",
    "32": "数电发票（增值税普通发票）",
    "51": "数电发票（铁路电子客票）",
    "59": "数电票（通行费发票）",
    "61": "数电发票（航空运输电子客票行程单）",
    "83": "数电票（机动车销售统一发票）",
    "84": "数电票（二手车销售统一发票）",
    "85": "数电纸质发票（增值税专用发票）",
    "86": "数电纸质发票（增值税普通发票）",
    "87": "数电纸质发票（机动车销售统一发票）",
    "88": "数电纸质发票（二手车销售统一发票）",
    "1002": "火车票",
    "1003": "航空电子客票行程单",
    "1004": "出租车发票",
    "1005": "通用定额发票",
    "1006": "公路水路客运发票",
    "1007": "通用机打发票",
    "1008": "过路费发票",
    "1009": "区块链电子发票",
    "1010": "火车票退票费",
    "1011": "医疗电子票据（住院）",
    "1012": "医疗电子票据（门诊）",
    "1013": "通用电子发票",
    "1014": "完税凭证",
    "1015": "海关缴款书",
    "1016": "航空运输电子客票行程单退改费",
    "1017": "财政票据",
}


def fix_text(value):
    """修复百望返回中偶发的 UTF-8 被 latin1 展示的文本。"""
    if not isinstance(value, str):
        return value
    for encoding in ("cp1252", "latin1"):
        try:
            fixed = value.encode(encoding).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if any("\u4e00" <= char <= "\u9fff" for char in fixed):
            return fixed
    return value


def clean_text(value):
    if value is None:
        return ""
    return fix_text(str(value)).strip()


def normalize_json_text(value):
    if isinstance(value, dict):
        return {k: normalize_json_text(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize_json_text(v) for v in value]
    return fix_text(value)


def amount_string(value):
    if value is None or value == "":
        return ""
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return clean_text(value)
    return str(decimal_value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def first_amount(*values):
    for value in values:
        formatted = amount_string(value)
        if formatted:
            return formatted
    return ""


def invoice_type_name(invoice):
    raw_name = clean_text(invoice.get("invoiceTemplateName") or invoice.get("noteName") or invoice.get("invoiceName"))
    mapped_name = INVOICE_TYPE_NAMES.get(clean_text(invoice.get("invoiceType")))
    if mapped_name and raw_name in GENERIC_INVOICE_NAMES:
        return mapped_name
    return raw_name or mapped_name or ""


def is_pure_digital(invoice_number, invoice_code, invoice_name):
    if "纸质" in invoice_name:
        return False
    return len(invoice_number) == 20 and invoice_number.isdigit() and not invoice_code


def decide_verify_params(invoice):
    invoice_number = clean_text(invoice.get("invoiceNo") or invoice.get("electronicNo") or invoice.get("machineInvoiceNo"))
    invoice_code = clean_text(invoice.get("invoiceCode") or invoice.get("machineInvoiceCode"))
    billing_date = clean_text(invoice.get("invoiceDate") or invoice.get("time"))
    invoice_name = invoice_type_name(invoice)
    check_code = clean_text(invoice.get("checkCode"))

    params = {}
    missing = []
    decision = {
        "invoice_name": invoice_name,
        "rule": "",
        "verify_supported": True,
        "needs_follow_up": False,
        "missing_fields": missing,
    }

    if invoice_number:
        params["invoiceNumber"] = invoice_number
    else:
        missing.append("invoiceNumber")
    if billing_date:
        params["billingDate"] = billing_date
    else:
        missing.append("billingDate")

    if is_pure_digital(invoice_number, invoice_code, invoice_name):
        amount = first_amount(invoice.get("amountTax"), invoice.get("totalAmount"))
        if amount:
            params["totalAmount"] = amount
            decision["rule"] = "pure_digital_amount_tax"
        else:
            missing.append("amountTax")
    else:
        if invoice_code:
            params["invoiceCode"] = invoice_code
        if "专用" in invoice_name or "机动车销售" in invoice_name:
            amount = first_amount(invoice.get("nonVatAmount"), invoice.get("totalAmount"))
            if amount:
                params["totalAmount"] = amount
                decision["rule"] = "non_digital_non_vat_amount"
            else:
                missing.append("nonVatAmount")
        elif "二手车销售" in invoice_name:
            amount = first_amount(invoice.get("amountTax"), invoice.get("totalAmount"))
            if amount:
                params["totalAmount"] = amount
                decision["rule"] = "used_car_vehicle_price"
            else:
                missing.append("amountTax")
        elif any(keyword in invoice_name for keyword in ("普通", "通行费", "卷票", "卷式")):
            check_code_6 = check_code[-6:] if len(check_code) >= 6 else invoice_number[-6:]
            if check_code_6:
                params["checkCode_6"] = check_code_6
                decision["rule"] = "normal_invoice_check_code"
            else:
                missing.append("checkCode_6")
        else:
            decision["verify_supported"] = False
            decision["needs_follow_up"] = True
            decision["rule"] = "unknown_invoice_type"
            missing.append("invoiceType")

    if params.get("totalAmount") or params.get("checkCode_6"):
        params["taxNo"] = "<PLATFORM_TAXNO>"
    elif "totalAmount/checkCode_6" not in missing:
        missing.append("totalAmount/checkCode_6")

    if missing:
        decision["needs_follow_up"] = True
        if any(field in missing for field in ("invoiceNumber", "billingDate", "totalAmount/checkCode_6")):
            decision["verify_supported"] = False

    return params, decision


def passenger_transport(invoice):
    invoice_type = clean_text(invoice.get("invoiceType"))
    travelers = invoice.get("passengerTransportation")
    if not isinstance(travelers, list):
        travelers = []
    travel_list = invoice.get("invoiceTravelList")
    if isinstance(travel_list, list) and travel_list:
        travelers = travelers or travel_list

    has_flag = invoice_type in {"51", "61", "1002", "1003", "1016"} or bool(travelers)
    has_traveler = any(
        clean_text(item.get("traveler") or item.get("passengerName") or item.get("validIdNumber"))
        for item in travelers
        if isinstance(item, dict)
    )
    billing_date = clean_text(invoice.get("invoiceDate"))
    needs_traveler = bool(billing_date and billing_date >= "2026-01-01")
    return {
        "is_passenger_transport": has_flag,
        "has_traveler_info": has_traveler,
        "date_rule": ">=2026-01-01需出行人" if needs_traveler else "<2026-01-01无需出行人",
        "deductible_amount": amount_string(invoice.get("deductTax") or invoice.get("totalTax")),
    }


def normalize_invoice(invoice, source_file):
    invoice_number = clean_text(invoice.get("invoiceNo") or invoice.get("electronicNo") or invoice.get("machineInvoiceNo"))
    invoice_code = clean_text(invoice.get("invoiceCode") or invoice.get("machineInvoiceCode"))
    seller_name = clean_text(invoice.get("saleName") or invoice.get("sellerName"))
    seller_tax_no = clean_text(invoice.get("saleTaxNo") or invoice.get("sellerTaxNo"))
    verify_params, decision = decide_verify_params(invoice)

    return {
        "source_file": source_file,
        "invoice_payload": {
            "invoice_code": invoice_code,
            "invoice_number": invoice_number,
            "billing_date": clean_text(invoice.get("invoiceDate") or invoice.get("time")),
            "total_amount": verify_params.get("totalAmount", ""),
            "check_code_6": verify_params.get("checkCode_6", ""),
            "seller_name": seller_name,
            "seller_tax_no": seller_tax_no,
            "purchaser_name": clean_text(invoice.get("purchaserName")),
            "purchaser_tax_no": clean_text(invoice.get("purchaserTaxNo")),
            "tax_amount": amount_string(invoice.get("totalTax")),
            "amount_tax": amount_string(invoice.get("amountTax")),
            "invoice_type": clean_text(invoice.get("invoiceType")),
            "invoice_name": decision["invoice_name"],
        },
        "verify_params": verify_params,
        "risk_input": {
            "taxpayer": seller_name,
            "taxpayercode": seller_tax_no,
        },
        "passenger_transport": passenger_transport(invoice),
        "decision": decision,
    }


def build_params(file_paths, user_account, is_save, collect_way, upload_mode):
    files_map = []
    normalized_paths = []
    for raw_path in file_paths:
        file_path = Path(raw_path).resolve()
        if not file_path.exists() or not file_path.is_file():
            raise ValueError(f"文件不存在：{file_path}")
        if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"不支持的文件格式：{file_path.suffix}")
        if len(file_path.name) > 50:
            raise ValueError(f"文件名超过 50 个字符：{file_path.name}")
        normalized_paths.append(file_path)
        files_map.append(
            {
                "fileName": file_path.name,
                "fileBase64": base64.b64encode(file_path.read_bytes()).decode("ascii"),
            }
        )

    return (
        {
            "filesMap": files_map,
            "userAccount": user_account,
            "isSave": is_save,
            "collectWay": collect_way,
            "uploadMode": upload_mode,
        },
        normalized_paths,
    )


def parse_mcp_result(result, source_files):
    fallback = {
        "type": "llm_multimodal_recognition",
        "when": "recogcollect_failed_or_missing_invoice_fields",
        "next_step": "use_llm_read_to_extract_invoice_fields_then_standardize",
    }

    if not isinstance(result, dict):
        return {"success": False, "error": {"message": f"未知返回类型：{type(result).__name__}"}, "items": [], "fallback": fallback}

    if result.get("isError"):
        return {
            "success": False,
            "error": normalize_json_text(result.get("result", {}).get("error", {})),
            "items": [],
            "fallback": fallback,
        }

    content = result.get("content")
    if not isinstance(content, list) or not content:
        return {"success": False, "error": {"message": "MCP 返回 content 为空"}, "items": [], "fallback": fallback}

    raw_text = content[0].get("text") if isinstance(content[0], dict) else ""
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as error:
        return {"success": False, "error": {"message": f"返回 JSON 解析失败：{error}"}, "items": [], "fallback": fallback}

    if isinstance(payload, dict):
        response = payload.get("response", [])
        if payload.get("success") is False:
            return {"success": False, "error": normalize_json_text(payload.get("errorResponse", {})), "items": [], "fallback": fallback}
    else:
        response = payload

    if not isinstance(response, list):
        return {"success": False, "error": {"message": "response 不是数组"}, "items": [], "fallback": fallback}

    items = []
    errors = []
    for index, wrapper in enumerate(response):
        source_file = source_files[index].name if index < len(source_files) else f"file_{index + 1}"
        if not isinstance(wrapper, dict):
            errors.append({"source_file": source_file, "message": "单文件返回不是对象"})
            continue
        invoices = wrapper.get("mediaInvoiceList")
        if not isinstance(invoices, list) or not invoices:
            errors.append({"source_file": source_file, "message": "未返回 mediaInvoiceList"})
            continue
        for invoice in invoices:
            if isinstance(invoice, dict):
                items.append(normalize_invoice(invoice, source_file))

    output = {
        "success": bool(items) and not errors,
        "tool": call_mcp.IMAGE_RECOGCOLLECT_TOOL,
        "item_count": len(items),
        "items": items,
        "errors": errors,
    }
    if errors or not items:
        output["fallback"] = fallback
    return output


def main():
    call_mcp.load_env_file()
    call_mcp.load_mcp_config()

    parser = argparse.ArgumentParser(description="通过影像识别采集 MCP 接口识别发票文件")
    parser.add_argument("file_path", nargs="+", help="本地发票文件路径，支持图片/PDF/OFD/XML")
    parser.add_argument("--url", default="BAIWANG_OCR_STANDARD_URL", help="MCP Server URL 或配置键名")
    parser.add_argument("--user-account", default="", help="用户账号；不传时读取 WorkBuddy 注入配置")
    parser.add_argument("--is-save", type=int, default=1, help="是否入库，1=不入库，0=入库")
    parser.add_argument("--collect-way", type=int, default=4, help="采集方式，4=接口")
    parser.add_argument("--upload-mode", type=int, default=0, help="发票上传模式")
    parser.add_argument("--no-retry", action="store_true", help="禁用 MCP 重试")
    parser.add_argument("--raw", action="store_true", help="输出原始 MCP content 文本，仅用于调试")
    args = parser.parse_args()

    user_account = args.user_account.strip() or call_mcp._get_recogcollect_user_account()
    if not user_account:
        print("缺少 userAccount：请通过 --user-account 或 WorkBuddy 注入 BAIWANG_IMAGE_RECOGCOLLECT_USER_ACCOUNT", file=sys.stderr)
        return 1

    try:
        params, source_files = build_params(args.file_path, user_account, args.is_save, args.collect_way, args.upload_mode)
    except ValueError as error:
        print(f"参数错误：{error}", file=sys.stderr)
        return 1

    server_url = call_mcp.resolve_url(args.url)
    try:
        params = call_mcp._inject_and_validate(server_url, call_mcp.IMAGE_RECOGCOLLECT_TOOL, params)
    except ValueError as error:
        print(f"参数校验失败：{error}", file=sys.stderr)
        return 1

    if args.no_retry:
        result = call_mcp.send_mcp_request(server_url, call_mcp.IMAGE_RECOGCOLLECT_TOOL, params)
    else:
        result = call_mcp.send_mcp_request_with_retry(server_url, call_mcp.IMAGE_RECOGCOLLECT_TOOL, params)

    if args.raw:
        content = result.get("content") if isinstance(result, dict) else None
        print((content or [{}])[0].get("text", "") if isinstance(content, list) else json.dumps(result, ensure_ascii=False))
        return 0 if isinstance(result, dict) and not result.get("isError") else 1

    output = parse_mcp_result(result, source_files)
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if output.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
