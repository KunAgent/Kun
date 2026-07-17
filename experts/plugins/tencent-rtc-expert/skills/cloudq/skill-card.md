## Description: <br>
CloudQ helps agents answer cloud operations questions through Tencent Cloud Smart Advisor, including multi-cloud resource queries, architecture visualization, risk assessment, and AI-powered operations guidance. <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[1ncludesteven](https://clawhub.ai/user/1ncludesteven) <br>

### License/Terms of Use: <br>
MIT-0 <br>


## Use Case: <br>
Cloud operators, developers, and support agents use CloudQ to ask cloud and multi-cloud operations questions, inspect resource and architecture health, evaluate risk, and get cost, security, compliance, and operations guidance. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: The skill requires Tencent Cloud credentials and can access sensitive cloud account context. <br>
Mitigation: Prefer OAuth or a least-privilege subaccount and avoid broad long-lived AK/SK credentials unless role creation or passwordless console links are intentionally needed. <br>
Risk: Environment checks and setup flows may create, attach, or delete IAM roles and policies. <br>
Mitigation: Review check_env.py, create_role.py, and cleanup.py behavior before use, and require explicit user approval before executing IAM-changing steps. <br>
Risk: CloudQ forwards cloud operations questions to Tencent Cloud services and may return links or operational recommendations. <br>
Mitigation: Review returned recommendations and links before acting on them in production environments. <br>


## Reference(s): <br>
- [CloudQ on ClawHub](https://clawhub.ai/1ncludesteven/cloudq) <br>
- [1ncludesteven publisher profile](https://clawhub.ai/user/1ncludesteven) <br>
- [CloudQChatCompletions API reference](artifact/references/api/CloudQChatCompletions.md) <br>
- [Tencent CloudQ article](https://cloud.tencent.com/developer/article/2645159) <br>
- [Tencent Cloud Smart Advisor console](https://console.cloud.tencent.com/advisor) <br>


## Skill Output: <br>
**Output Type(s):** [text, markdown, shell commands, configuration, guidance] <br>
**Output Format:** [Markdown with inline shell commands and links returned from Tencent Cloud services] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Cloud questions are forwarded to Tencent Cloud APIs and may require asynchronous polling before final Markdown content is available.] <br>

## Skill Version(s): <br>
1.7.0 (source: frontmatter and release evidence) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
