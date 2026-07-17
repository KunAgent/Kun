#!/usr/bin/env python3
"""
Scenario Modeler — Models base/bull/bear cases from financial analysis.

Takes a JSON file with financial summary data and projects 12-month scenarios.
Outputs to stdout and saves JSON for further analysis.

Usage:
    python3 scenario-modeler.py --input ./data/financial-latest.json
    python3 scenario-modeler.py --input ./data/financial-latest.json --output ./data/scenarios.json
"""

import argparse
import json
import os
import sys
from datetime import datetime


def load_financial_data(input_path: str) -> dict:
    """Load financial summary JSON."""
    with open(input_path) as f:
        return json.load(f)


def model_base_case(data: dict) -> dict:
    """Current trajectory continues. No growth, no cuts."""
    monthly_rev = data["total_revenue"] / 12
    monthly_cogs = data["total_cogs"] / 12
    monthly_opex = data["total_opex"] / 12
    monthly_other = data.get("other_expenses", 0) / 12 - data.get("other_income", 0) / 12
    monthly_net = data["net_income"] / 12

    projections = []
    for m in range(1, 13):
        projections.append({
            "month": m,
            "revenue": round(monthly_rev, 2),
            "total_costs": round(monthly_cogs + monthly_opex + monthly_other, 2),
            "net_income": round(monthly_net, 2),
            "cumulative_pl": round(monthly_net * m, 2),
        })

    monthly_burn = abs(monthly_net) if monthly_net < 0 else 0
    breakeven_monthly_cut = monthly_burn  # How much to cut monthly to break even

    return {
        "name": "Base Case — Status Quo",
        "description": "Current trajectory continues. No new clients, no lost clients, no cost changes.",
        "assumptions": [
            f"Revenue stays flat at ~${monthly_rev:,.0f}/mo",
            f"COGS stays at ~${monthly_cogs:,.0f}/mo",
            f"OpEx stays at ~${monthly_opex:,.0f}/mo",
            "No new hires, no layoffs",
        ],
        "monthly_burn": round(monthly_burn, 2),
        "annual_projected_loss": round(data["net_income"], 2) if data["net_income"] < 0 else 0,
        "annual_projected_profit": round(data["net_income"], 2) if data["net_income"] > 0 else 0,
        "months_to_breakeven": "N/A (already profitable)" if monthly_net > 0 else "Never (at current trajectory)",
        "key_levers": [
            f"Cut ${breakeven_monthly_cut:,.0f}/mo from costs to break even" if monthly_burn > 0 else "Maintain current discipline",
            f"Or grow revenue {round(monthly_burn / monthly_rev * 100, 1)}% while holding costs flat" if monthly_burn > 0 and monthly_rev > 0 else "Focus on margin expansion",
            "Audit subscriptions and contractor spend for quick wins",
        ],
        "projections": projections,
    }


def model_bull_case(data: dict, new_product_arr: float = 500000, new_clients: int = 3, avg_client_mrr: float = 15000) -> dict:
    """Growth targets met: new product revenue + new agency clients."""
    monthly_rev = data["total_revenue"] / 12
    monthly_cogs = data["total_cogs"] / 12
    monthly_opex = data["total_opex"] / 12
    monthly_other = data.get("other_expenses", 0) / 12 - data.get("other_income", 0) / 12

    product_monthly = new_product_arr / 12
    new_clients_monthly = new_clients * avg_client_mrr
    # Product has SaaS margins (~80%), services have ~50% margin
    product_cogs = product_monthly * 0.20
    services_cogs = new_clients_monthly * 0.50

    projections = []
    for m in range(1, 13):
        # Ramp: product over 6 months, clients added quarterly
        product_ramp = min(m / 6, 1.0)
        client_ramp = min(m, new_clients) / new_clients
        month_rev = monthly_rev + (product_monthly * product_ramp) + (new_clients_monthly * client_ramp)
        month_costs = monthly_cogs + monthly_opex + monthly_other + (product_cogs * product_ramp) + (services_cogs * client_ramp)
        month_net = month_rev - month_costs

        projections.append({
            "month": m,
            "revenue": round(month_rev, 2),
            "total_costs": round(month_costs, 2),
            "net_income": round(month_net, 2),
            "cumulative_pl": round(sum(p["net_income"] for p in projections) + month_net, 2),
        })

    breakeven_month = None
    for p in projections:
        if p["net_income"] > 0:
            breakeven_month = p["month"]
            break

    return {
        "name": "Bull Case — Product + Growth",
        "description": f"New product hits ${new_product_arr/1000:.0f}K ARR, add {new_clients} clients at ${avg_client_mrr/1000:.0f}K/mo.",
        "assumptions": [
            f"Product ramps to ${product_monthly:,.0f}/mo over 6 months",
            f"{new_clients} new clients at ${avg_client_mrr:,.0f}/mo each, added quarterly",
            "Product has 80% gross margin (SaaS)",
            "New services clients at 50% margin",
            "No additional OpEx needed (existing team absorbs)",
        ],
        "additional_annual_revenue": round((product_monthly + new_clients_monthly) * 12, 2),
        "monthly_profit_at_full_ramp": round(projections[-1]["net_income"], 2) if projections[-1]["net_income"] > 0 else 0,
        "months_to_breakeven": breakeven_month if breakeven_month else ">12 months",
        "key_levers": [
            "Product-market fit and sales execution",
            f"Services pipeline — need 1 new ${avg_client_mrr/1000:.0f}K client per quarter",
            "Keep OpEx flat during growth phase",
            "SaaS margins dramatically improve blended margin",
        ],
        "projections": projections,
    }


def model_bear_case(data: dict, pct_revenue_lost: float = 0.30) -> dict:
    """Lose significant portion of revenue (e.g., top clients churn)."""
    monthly_rev = data["total_revenue"] / 12
    monthly_cogs = data["total_cogs"] / 12
    monthly_opex = data["total_opex"] / 12
    monthly_other = data.get("other_expenses", 0) / 12 - data.get("other_income", 0) / 12

    lost_revenue = data["total_revenue"] * pct_revenue_lost
    monthly_lost = lost_revenue / 12
    # Save ~45% of lost revenue in COGS (team partially redeployed)
    monthly_saved_cogs = monthly_lost * 0.45

    projections = []
    for m in range(1, 13):
        month_rev = monthly_rev - monthly_lost
        month_costs = (monthly_cogs - monthly_saved_cogs) + monthly_opex + monthly_other
        month_net = month_rev - month_costs

        projections.append({
            "month": m,
            "revenue": round(month_rev, 2),
            "total_costs": round(month_costs, 2),
            "net_income": round(month_net, 2),
            "cumulative_pl": round(month_net * m, 2),
        })

    return {
        "name": f"Bear Case — Lose {pct_revenue_lost*100:.0f}% Revenue",
        "description": f"Top clients churn, losing {pct_revenue_lost*100:.0f}% of revenue.",
        "assumptions": [
            f"Lose ${lost_revenue:,.0f}/yr ({pct_revenue_lost*100:.0f}% of revenue)",
            "COGS reduces ~45% of lost revenue (team partially redeployed)",
            "OpEx stays fixed (can't cut fast enough)",
            "No replacement clients in forecast period",
        ],
        "lost_annual_revenue": round(lost_revenue, 2),
        "new_annual_revenue": round(data["total_revenue"] - lost_revenue, 2),
        "monthly_burn": round(abs(projections[0]["net_income"]), 2) if projections[0]["net_income"] < 0 else 0,
        "annual_projected_loss": round(projections[0]["net_income"] * 12, 2),
        "months_to_breakeven": "Requires major restructuring",
        "key_levers": [
            f"Immediate need: cut ${abs(projections[0]['net_income']):,.0f}/mo in costs",
            "Reduce headcount in affected service lines",
            "Accelerate sales pipeline to replace lost revenue",
            "Consider consolidating service lines",
        ],
        "required_monthly_cost_cuts": round(abs(projections[0]["net_income"]), 2) if projections[0]["net_income"] < 0 else 0,
        "projections": projections,
    }


def main():
    parser = argparse.ArgumentParser(description='Financial Scenario Modeler')
    parser.add_argument('--input', '-i', required=True,
                       help='Path to financial summary JSON (output from cfo-analyzer history)')
    parser.add_argument('--output', '-o', default=None,
                       help='Output path for scenarios JSON (default: stdout only)')
    parser.add_argument('--product-arr', type=float, default=500000,
                       help='Bull case: new product ARR target (default: 500000)')
    parser.add_argument('--new-clients', type=int, default=3,
                       help='Bull case: number of new clients (default: 3)')
    parser.add_argument('--client-mrr', type=float, default=15000,
                       help='Bull case: average new client MRR (default: 15000)')
    parser.add_argument('--bear-loss-pct', type=float, default=0.30,
                       help='Bear case: percentage of revenue lost (default: 0.30)')
    args = parser.parse_args()

    print("🔮 Scenario Modeler — Building projections...", file=sys.stderr)

    data = load_financial_data(args.input)

    scenarios = {
        "base_case": model_base_case(data),
        "bull_case": model_bull_case(data, args.product_arr, args.new_clients, args.client_mrr),
        "bear_case": model_bear_case(data, args.bear_loss_pct),
        "generated_at": datetime.now().isoformat(),
        "based_on_period": data.get("period", "Unknown"),
    }

    # Summary comparison
    scenarios["summary"] = {
        "base_monthly_burn": scenarios["base_case"]["monthly_burn"],
        "bull_monthly_profit": scenarios["bull_case"].get("monthly_profit_at_full_ramp", 0),
        "bear_monthly_burn": scenarios["bear_case"]["monthly_burn"],
        "current_net_income": data["net_income"],
    }

    if args.output:
        os.makedirs(os.path.dirname(args.output) or '.', exist_ok=True)
        with open(args.output, "w") as f:
            json.dump(scenarios, f, indent=2)
        print(f"✅ Scenarios saved to {args.output}", file=sys.stderr)

    # Print summary to stdout
    print(f"\n{'='*60}")
    for case_key in ["base_case", "bull_case", "bear_case"]:
        case = scenarios[case_key]
        print(f"\n📌 {case['name']}")
        print(f"   {case['description']}")
        if case.get("monthly_burn"):
            print(f"   Monthly burn: ${case['monthly_burn']:,.0f}")
        if case.get("monthly_profit_at_full_ramp"):
            print(f"   Monthly profit at ramp: ${case['monthly_profit_at_full_ramp']:,.0f}")
        print(f"   Breakeven: {case['months_to_breakeven']}")
        print(f"   Key levers:")
        for lever in case.get("key_levers", []):
            print(f"     • {lever}")


if __name__ == "__main__":
    main()
