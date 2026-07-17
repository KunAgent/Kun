# Policy Direction Scan Playbook

## Goal

Turn newly released ministry or multi-ministry AI policy documents into:

- one concrete workflow gap
- one policy-fit mapping card
- one short pilot packet
- one evidence ledger

Do not stop at policy summary or concept explanation.

## Input Standard

Minimum inputs:

- official policy text or authoritative repost
- target industry
- target role
- current business objective

Optional inputs:

- current SOP
- current data sources
- current system stack
- current compliance constraints

## Policy Source Ledger Standard

For policy-triggered work, bind the answer to `contracts/policy-direction-ledger-202606.json`.
The current built-in policy window is:

- primary trigger date: `2026-06-18`
- recent policy window: `2026-01-01/2026-06-19`
- freshness guard: `14` days
- primary trigger source: `ai-consumption-20260618`

Each source row must include:

- `sourceTitle`
- `sourceUrl`
- `publisher`
- `publishedAt`
- `retrievedAt`
- `evidenceStrength`
- `clientUseStatus`
- `claim`
- `policySignals`
- `scenarioFamilies`
- `workflowGapHints`
- `riskBoundaries`

Authoritative reposts are allowed for internal scenario mapping when a ministry page is temporarily hard to lock, but customer-facing citation requires primary URL review before use. The ledger seeds direction mapping only; it is not a connector, live network dependency, service consume event, official listing proof, or business closure proof.

## Conversion Flow

1. Extract policy signals:
   policy objective, named sectors, named scenarios, named infrastructure, named data requirements, named safety/governance constraints.
2. Map to scenario families:
   product/service innovation, process optimization, decision support, physical-world automation, public service or governance, data infrastructure.
3. Narrow to one workflow gap:
   choose the gap with the highest business value, shortest verification loop, and clearest input path.
4. Materialize into Industry Scene Researcher outputs:
   supplement card, capability map, human-AI task table, 3-day pilot packet, single CTA.

## 2026 High-Frequency Policy Themes

Observed repeatedly across recent ministry-grade documents:

- AI plus consumption:
  smart terminals, household services, elderly care, cultural tourism, hospitality and catering, retail and e-commerce, logistics and delivery, commercial complexes and smart business districts.
- AI plus education:
  classroom assistants, teacher assistants, education agents, virtual-real training, education models, education governance and safety.
- AI plus energy:
  power-forecasting, dispatch optimization, predictive maintenance, grid safety, oil and gas exploration, virtual power plants, storage safety, energy data assets, energy models.
- AI for SMEs and manufacturing:
  R&D design, simulation, production control, quality inspection, equipment maintenance, procurement and supply, marketing and after-sales, contract review, finance/HR automation, customer service.

## Default Mapping Rules

When the policy is broad, prefer these cuts:

- consumer-facing policy -> service flow gap
- industrial policy -> operating or production gap
- education policy -> human-AI teaching or training gap
- energy policy -> high-value operational decision or maintenance gap
- SME policy -> process automation or productized service gap

## Output Template

The first structured artifact should answer:

- which industry is most directly hit by the policy
- which role is the best first user
- which workflow gap should be tested first
- what data or materials are minimally required
- what 3-day pilot can prove or disprove the direction

Recommended companion artifacts:

- `policy_fit_matrix`
- `policyDirectionLedger`
- `regulatory_readiness_note`
- `three_day_pilot_packet`

## Evidence Rules

- Prefer `official_doc` for ministry or multi-ministry texts.
- Use `authoritative_repost` only as internal reference until the primary source URL is locked.
- Use `internal_reference_only` by default until the user explicitly requests customer-facing citation.
- Do not treat policy direction as proof that the target company has data, budget, or organizational readiness.
- Do not upgrade policy support into product credit, official listing, or business closure.

## Good Outcome

A strong answer does not say:

- this policy means the industry is promising

It says:

- for this industry, this role, and this business objective, the policy most strongly supports this workflow gap, and here is the smallest pilot to test it.
