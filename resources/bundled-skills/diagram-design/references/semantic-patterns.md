# Semantic patterns

Use one when behavior is load-bearing.

- Fan-in queue / bottleneck → data-flow. Show producers, queue capacity, consumer rate, and overflow/backpressure.
- Stage framework with semantic slots → process. Repeat question/input/governance/output slots across stages.
- Unstructured input → durable artifact → data-flow. Distinguish interpretation, validation, and persisted result.
- Paired policy-evaluation traces → flowchart. Show pass/fail/skipped/not-reached and first divergence.
- Secure paved road → architecture. Show trust boundaries and permitted versus forbidden ingress/deploy paths.
- Governance/control catalog → layer-stack. Group controls by enforcement location.
- Compensating security layers → layer-stack. Show which defense covers a prior gap and where residual risk continues.

The pattern owns semantic primitives and may impose a tighter complexity budget; the visual type owns layout.
