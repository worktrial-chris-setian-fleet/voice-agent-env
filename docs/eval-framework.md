# Learning Loop Framework

## Approach: trajectory-based prompt optimization

We can't update Claude's weights directly in this repo, so the learnable part of the caller policy is its **system prompt**. The current implementation treats prompt text as the versioned policy artifact: runs produce summaries and trajectories, prompt updates produce candidate policies, and candidate policies are compared against the current policy before promotion.

This is sometimes called in-context RL or rejection-sampling fine-tuning applied at the prompt level. It's the right fit here because:
- Episodes are short and episodic (clear start/end, clean return signal)
- The reward signal is already shaped (turn penalties + terminal outcome)
- The environment is stable enough that a few good demonstrations meaningfully improve prompt-level behavior
- It produces interpretable updates — you can read the prompt and see what changed

---

## Current implementation

### 1. Trajectory collection

Every episode produces a stored trajectory plus a run summary. These are persisted under `artifacts/` as:

- `artifacts/baseline/baseline.json`
- `artifacts/experiments/<experiment-id>/experiment.json`
- `artifacts/experiments/<experiment-id>/policies/<policy-id>.json`
- `artifacts/experiments/<experiment-id>/runs/<run-id>/manifest.json`
- `artifacts/experiments/<experiment-id>/runs/<run-id>/summary.json`
- `artifacts/experiments/<experiment-id>/runs/<run-id>/trajectories.jsonl`
- `artifacts/experiments/<experiment-id>/comparisons/*.json`

Each stored trajectory includes scenario metadata, conversation history, reward breakdown, multistep progress, raw tool traces, and caller-behavior metrics.

### 2. Policy improvement

There are two updater modes today:

- **`manual`** — use a provided replacement prompt
- **`llm`** — ask Claude to revise the prompt using recent run summaries plus a small set of failure samples

The implemented LLM updater currently focuses on:
- invalid actions
- premature submit behavior
- premature target requests
- weak disambiguation behavior
- avoiding regressions on golden scenarios

Candidate prompts are stored as policy versions, not applied in place.

### 3. Evaluation

Three run suites are available in the implementation:

**Golden suite (regression anchor)**
`npm run golden` runs the same 6 fixed scenarios every generation. This is the floor — the policy must not get worse on known scenarios. If golden pass rate drops, the update is rejected. A healthy policy should hold 6/6 throughout training, including the multistep resolve-then-retrieve case.

**Stress suite (improvement signal)**
`npm run stress` runs 8 adversarial scenarios designed to expose known failure modes. Unlike the golden suite, some failures here are expected — the metric is reward score, not pass/fail. The suite targets four failure modes, two scenarios each:

| Scenarios | Failure mode targeted |
|-----------|----------------------|
| S1, S2 | Deep first-name-only disambiguation with hints the voice agent cannot directly resolve |
| S3, S4 | Ambiguous company fragments such as `"Technologies"` and `"Corp"` |
| S5, S6 | Contact ambiguity with weak or absent clues |
| S7, S8 | Resolve-then-retrieve chains that require follow-up after identity resolution |

Stress is intended as an improvement signal more than a binary pass/fail gate.

**Random suite**
`npm start` runs sampled episodes from the broader task distribution, with stochastic call routing still enabled.

**Generation metrics**
After each training generation, record: success rate, average return, average turns, and per-task-type breakdown. Plot these across generations to produce the learning curve. A meaningful improvement is a consistent rise in success rate across at least two consecutive generations, not a single lucky run.

---

### How pass/fail and reward relate

Pass/fail is purely answer correctness: an episode passes if a value was submitted and it matches the target after normalization. It does not account for how many turns it took or how much reward was spent getting there. An episode that passes at +2 (correct answer after 6 expensive turns) and one that passes at +8 (correct answer after 2 turns) look identical in pass/fail reporting.

**Reward is the right signal to optimize.** Pass/fail is a coarse proxy that misses the turn-efficiency dimension the penalty structure is designed to surface. Use pass rate as a sanity check (is the policy staying above baseline?), but track average return as the primary learning signal. A prompt update that holds pass rate flat while improving average return is a genuine improvement — it means the agent is getting correct answers more efficiently.

---

## Experiment loop structure

```
npm run experiment:init -- --label "prompt-pass-1"
  ↓
npm run experiment:step -- --experiment <id> --updater llm
  ↓
base policy runs on golden/stress/random
  ↓
candidate prompt generated and stored
  ↓
candidate policy runs on golden/stress/random
  ↓
run comparisons written; candidate promoted if it clears the gate
```

`npm run experiment:loop` simply repeats that step for multiple iterations.

---

## What success looks like

A healthy prompt-optimization loop should show, over multiple iterations:
- Success rate on training episodes trending upward from baseline (expect ~70–80% at generation 0 on easy tasks)
- Average turns decreasing as the caller learns to ask directly
- Stress suite avg reward increasing, especially on ambiguity-heavy scenarios
- Recovery rate after failed call attempts trending upward, as the caller learns to retry rather than quit

The metrics that are *not* meaningful signals: the raw frequency of ANSWERING_MACHINE, WRONG_NUMBER, and NO_ANSWER outcomes. These are drawn from fixed environment probabilities (10%/5%/5%) and will be noise at any sample size a training generation provides. Don't include them in the learning curve — they'll obscure real signal.

The golden suite staying at 6/6 is the integrity check. If the prompt is improving on random or stress tasks but regressing on golden tasks, the candidate should not be promoted.

---

## Key files

- `src/runner/run-orchestrator.ts` — run execution, experiment steps, candidate promotion logic
- `src/runner/artifact-writer.ts` — persisted run artifacts
- `src/policy/store.ts` — artifact layout and file I/O
- `src/policy/prompt-updater.ts` — manual and LLM prompt updaters
- `src/viewer/server.ts` — local inspection UI over stored artifacts
