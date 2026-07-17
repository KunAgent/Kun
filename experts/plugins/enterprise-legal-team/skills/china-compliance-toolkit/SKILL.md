---
name: china-compliance-toolkit
description: 中国企业法务本地化工具包，整合税务知识、涉税文书模板、合同风险扫描、PIPL 合规、诉讼费估算和精选合规脚本。Use for China domestic contract, employment, privacy, tax, and compliance workflows.
allowed-tools: Read, Bash
---

# 中国企业法务本地化工具包

This skill merges useful China-facing legal skills into the enterprise legal team. It intentionally excludes packages flagged as empty, purely promotional, or not useful in the analysis report.

## Imported and optimized sources

- `china-tax-law`: tax-rate references and tax compliance checklist.
- `legal-doc-writer`: tax planning report, legal opinion, tax reconsideration / litigation, and tax clause templates.
- `china-contract-review`: entry-level China contract review flow and labor/sales contract review points.
- `ai-legal-assistant-pro`: contract risk patterns, clause redraft playbook, litigation cost formula, labor dispute scenarios, document skeletons, and privacy/trust rules. Sales/upgrade copy was removed.
- `pipl-compliance`: PIPL law notes, checklist, risk assessment guide, enforcement cases, plus two deterministic scripts (`pipl-check.py`, `risk-assessment.py`). Template/document/report generators were not imported as executable tools.
- `legal-compliance-bundle`: only four useful rule/score scripts were extracted: contract review, labor contract check, PIPL compliance check, and compliance risk matrix. The promotional shell, placeholder scripts, and template-string generators were not imported.

## Not imported

Packages identified in the analysis report as empty shells, pure promotion, or generic prompt-only material were not copied as source content. Their useful high-level discipline, where any existed, is absorbed into the routing rules below rather than kept as standalone material.

## Retained executable scripts

Keep scripts only when they add deterministic value beyond direct AI drafting:

- API / current source lookup: handled separately by `china-legal-research/scripts/yd_search.py`.
- Calculations: `scripts/ai-legal-assistant/calculate_lawsuit_fee.py`.
- Rule scanning / scoring: `contract_review.py`, `labor_contract_check.py`, `pipl_compliance_check.py`, `compliance_risk_matrix.py`, `pipl-check.py`, `risk-assessment.py`.

Template-string generators, report formatters, demo scripts, and placeholder utilities are intentionally excluded. Their useful text belongs in references, not executable scripts.


## Qichacha MCP company-data integration

If WorkBuddy has enabled the Qichacha company connector, agents can call tools named `mcp__qcc-company__<tool_name>` without any extra skill configuration. Use Qichacha as the company-data layer, not as a legal conclusion engine.

Useful tools and legal scenarios:

- `mcp__qcc-company__verify_company_accuracy`: verify company name / legal representative / unified social credit code for contract party admission.
- `mcp__qcc-company__get_company_registration_info`: registration status, legal representative, capital, establishment date, address; useful for counterparty identity and contract header review.
- `mcp__qcc-company__get_company_profile`: industry and business profile; useful for product/legal fit and compliance context.
- `mcp__qcc-company__get_shareholder_info`, `mcp__qcc-company__get_actual_controller`, `mcp__qcc-company__get_beneficial_owners`: ownership, control, AML, related-party and diligence review.
- `mcp__qcc-company__get_key_personnel`, `mcp__qcc-company__get_branches`, `mcp__qcc-company__get_change_records`: governance, branch structure, and change-history checks.
- `mcp__qcc-company__get_financial_data`, `mcp__qcc-company__get_listing_info`, `mcp__qcc-company__get_annual_reports`: supplier/customer financial health, listed-company context, and annual-operation review.
- `mcp__qcc-company__get_external_investments`, `mcp__qcc-company__get_contact_info`, `mcp__qcc-company__get_tax_invoice_info`: group structure, contact/ICP context, and invoice identity.

If the tool is unavailable, ask the user to enable the Qichacha connector in WorkBuddy. It currently has daily free quota. Do not invent company profile, shareholder, controller, invoice, or financial data from memory.

## Routing

1. Contract review and clause redraft → use `references/ai-legal-assistant-pro/references/risk-patterns.md`, `clause-redraft-playbook.md`, `contract-type-guides.md`, plus selected contract scripts when appropriate.
2. Employment / labor disputes → use `labor-dispute-scenarios.md`, `labor-compensation-output-template.md`, and `labor_contract_check.py`.
3. PIPL / data compliance → use `references/pipl-compliance/references/`, `scripts/pipl/pipl-check.py`, `scripts/pipl/risk-assessment.py`, and the selected `pipl_compliance_check.py` rules script.
4. Tax → use `references/china-tax-law/` and `references/legal-doc-writer/`.
5. Litigation cost and document skeletons → use `calculate_lawsuit_fee.py` and `document-skeletons.md`.


## About `risk-assessment.py --activity`

In commands such as `python3 scripts/pipl/risk-assessment.py --activity "用户注册" --data medium --volume medium --format json`, `用户注册` is just the name of the personal-information processing activity being assessed (user registration / account signup). It is not a registration code, does not register a user, and does not call an external service. The script is a local deterministic risk-scoring helper: it combines data sensitivity, processing scale, purpose, third-party involvement, and security level into a first-pass PIPL risk score.

## Output rule

Keep the source workflow's structure, but remove marketing language, unsupported product claims, and empty placeholder capabilities. For any legal conclusion, cite the source material used and tell the user what still needs licensed lawyer or current official-source verification.
