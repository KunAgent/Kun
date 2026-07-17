# Humanize PPT Agent Teams V0.2 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build Humanize PPT into a main Agent Teams orchestrator that loads the `humanize-ppt` Skill, produces AST contracts, routes work to specialist Skill Agents, and verifies final PPT outputs.

**Architecture:** The main Humanize PPT Agent owns AST, routing, command generation, run manifest, and QA. Specialist agents each load one focused Skill and operate only on contract files, not raw source, unless explicitly allowed.

**Tech Stack:** Python stdlib, JSON contracts, Markdown commands, static HTML demo runner, GitHub Pages.

---

## Task 1: Add Agent Team contract schemas

**Objective:** Define machine-readable contracts for routing and run manifests.

**Files:**
- Create: `contracts/router-plan.schema.json`
- Create: `contracts/run-manifest.schema.json`

**Step 1: Create `router-plan.schema.json`**

Include fields:

```json
{
  "source": "string",
  "goal": "string",
  "routes": [
    {
      "agent": "string",
      "skill": "string",
      "purpose": "string",
      "input_files": ["string"],
      "output_dir": "string",
      "depends_on": ["string"]
    }
  ]
}
```

**Step 2: Create `run-manifest.schema.json`**

Include fields:

```json
{
  "run_id": "string",
  "source": "string",
  "created_at": "string",
  "selected_routes": ["string"],
  "outputs": {},
  "verification": {}
}
```

**Step 3: Validate JSON**

Run:

```bash
python3 -m json.tool contracts/router-plan.schema.json >/dev/null
python3 -m json.tool contracts/run-manifest.schema.json >/dev/null
```

Expected: no output and exit code 0.

**Step 4: Commit**

```bash
git add contracts/router-plan.schema.json contracts/run-manifest.schema.json
git commit -m "feat: add agent team contract schemas"
```

---

## Task 2: Extend the local runner to emit Agent Team artifacts

**Objective:** Make `scripts/humanize_ppt_v1.py` generate `router_plan.json`, `run_manifest.json`, and `commands/`.

**Files:**
- Modify: `scripts/humanize_ppt_v1.py`

**Step 1: Add router plan generation**

Generate this output:

```text
out/router_plan.json
```

Routes for V0.2 simulation:

- `guizang-agent`
- `zara-agent`
- `presenter-agent`
- `qa-agent`

**Step 2: Add run manifest generation**

Generate:

```text
out/run_manifest.json
```

Include output paths and verification status.

**Step 3: Add command files**

Generate:

```text
out/commands/guizang-agent.md
out/commands/zara-agent.md
out/commands/presenter-agent.md
out/commands/qa-agent.md
```

Each command must include:

```text
You are [Agent Name].
Load skill: [Skill Name].
Input directory: [workdir]
Task: [exact task]
Write outputs to: [exact output directory]
Return: output paths, decisions, issues, verification result.
```

**Step 4: Run demo**

```bash
python3 scripts/humanize_ppt_v1.py \
  --source examples/02-hermes-install-guide/source.md \
  --out .humanize-ppt-runs/hermes-install-agent-team \
  --title "把 Hermes 装成一个真正能干活的 Agent"
```

Expected files:

```text
router_plan.json
run_manifest.json
commands/guizang-agent.md
commands/zara-agent.md
commands/presenter-agent.md
commands/qa-agent.md
```

**Step 5: Commit**

```bash
git add scripts/humanize_ppt_v1.py .humanize-ppt-runs/hermes-install-agent-team || true
git add scripts/humanize_ppt_v1.py
git commit -m "feat: emit agent team orchestration artifacts"
```

---

## Task 3: Add simulated specialist output directories

**Objective:** Make the V0.2 demo look like an Agent Team run instead of a single script output.

**Files:**
- Modify: `scripts/humanize_ppt_v1.py`

**Step 1: Create output layout**

Generate:

```text
out/outputs/guizang/
out/outputs/zara/
out/outputs/presenter/
out/outputs/qa/
```

**Step 2: Copy existing generated files into specialist outputs**

- `styles/guizang-stable.html` → `outputs/guizang/index.html`
- `styles/zara-editorial.html` and `styles/zara-contrast.html` → `outputs/zara/directions/`
- `presenter/index.html` → `outputs/presenter/index.html`
- QA report → `outputs/qa/qa_report.md`

**Step 3: Verify paths**

Run:

```bash
python3 scripts/humanize_ppt_v1.py --source examples/02-hermes-install-guide/source.md --out /tmp/humanize-agent-team-test --title test
find /tmp/humanize-agent-team-test/outputs -type f | sort
```

Expected: files under all four output directories.

**Step 4: Commit**

```bash
git add scripts/humanize_ppt_v1.py
git commit -m "feat: add simulated specialist agent outputs"
```

---

## Task 4: Add Agent Team docs to public site

**Objective:** Make the architecture visible to Tencent-facing readers and public users.

**Files:**
- Modify: `docs/index.html`
- Modify: `README.md`
- Modify: `README.en.md`
- Ensure: `docs/agent-teams.md`

**Step 1: Link `docs/agent-teams.md` from both READMEs**

Add top-level links:

```md
[Agent Teams](docs/agent-teams.md)
```

**Step 2: Link it from Pages home**

Add a card explaining:

```text
Humanize PPT Agent is the main orchestrator. Specialist agents load guizang, Zara, HyperFrames, Presenter, and QA skills.
```

**Step 3: Verify Pages locally**

```bash
python3 -m http.server 8767 --directory docs
curl -s -o /tmp/hp.html -w '%{http_code}' http://127.0.0.1:8767/
```

Expected: `200`.

**Step 4: Commit**

```bash
git add README.md README.en.md docs/index.html docs/agent-teams.md
git commit -m "docs: document agent teams architecture"
```

---

## Task 5: Release V0.2 preview

**Objective:** Push the Agent Teams architecture and verify deployment.

**Files:**
- No source changes required beyond previous tasks.

**Step 1: Run validations**

```bash
python3 -m json.tool contracts/slide-plan.schema.json >/dev/null
python3 -m json.tool contracts/video-slots.schema.json >/dev/null
python3 -m json.tool contracts/router-plan.schema.json >/dev/null
python3 -m json.tool contracts/run-manifest.schema.json >/dev/null
python3 scripts/humanize_ppt_v1.py --source examples/02-hermes-install-guide/source.md --out /tmp/humanize-v02-check --title test
```

**Step 2: Push**

```bash
git push origin main
```

**Step 3: Verify GitHub Pages**

```bash
curl -L -s -o /tmp/hp.html -w '%{http_code}' https://learnprompt.github.io/humanize-ppt/
grep -q "Agent Teams" /tmp/hp.html
```

Expected: `200`, grep success.

**Step 4: Install locally**

```bash
npx skills add https://github.com/LearnPrompt/humanize-ppt.git -g -y
```

**Step 5: Commit/tag if needed**

```bash
git tag -a v0.2.0-preview -m "v0.2.0 Agent Teams preview"
git push origin v0.2.0-preview
```

---

## Acceptance Criteria

- `README.md` communicates Humanize PPT as a main Agent controlling Skill Agents.
- `docs/agent-teams.md` exists and explains each specialist Agent.
- Runner emits `router_plan.json`, `run_manifest.json`, and command files.
- Demo output has separate specialist output directories.
- GitHub Pages shows Agent Teams entry.
- Local Skill installation works after push.
