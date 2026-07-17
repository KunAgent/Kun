# Privacy Notice

## Baseline

长文档手稿专家默认只处理用户主动提供的提纲、旧稿、访谈整理、研究笔记和补充材料。

By default, `long-manuscript-expert` only processes materials that the user explicitly provides in the current conversation or approved task flow.

## Processed Data Types

The package may process the following user-provided content when generating first value, continuation plans, revision suggestions, or finishing guidance:

- outlines
- old drafts
- interview notes
- transcripts
- research notes
- whitepaper source packs

## What The Package Does Not Do By Default

- It does not scan arbitrary local files without an explicit user request.
- It does not require hidden workspace indexing for first value.
- It does not treat probe traffic or diagnostic traces as natural product closure.
- It does not assume connector or MCP availability as a privacy baseline.

## Storage Boundary

The package itself is designed around reviewable files and generated verification reports.

By package default, stored data is limited to:

- package documentation
- generated review reports

The package is not designed to silently persist full user manuscript sources outside the normal host or user-approved workspace flow.

## Third-Party Sharing Boundary

Third-party sharing is `not_by_package_default`.

If a separate service-side observation layer exists, that layer must be reported separately from package compatibility and privacy scope. The package privacy baseline must not be widened just because an external runtime was observed in another report.

## Verification And Fact Checking Boundary

When external facts need validation, the response should explicitly state whether the information comes from:

- user-provided material
- the current conversation
- separately verified outside information

## Official Entry Boundary

- Local `my-experts` installation is local-equivalent evidence only.
- It is not proof that the expert has been officially listed in the WorkBuddy expert center.
- Official-entry runtime proof must be reverified after official listing appears.

## Related Documents

- Security boundary: `SECURITY.md`
- Terms of use: `TERMS.md`
- Support and review orchestration boundary: `contracts/review-orchestration-contract.json`
- Testing and verification reference: `references/quality/quality-check.md`
