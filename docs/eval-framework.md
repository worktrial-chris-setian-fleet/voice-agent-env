# Learning Loop Framework

## Approach: 'trajectory-based prompt optimization'

We can't update Claude's weights directly, so the learnable part of the caller policy is its **system prompt**. The prompt has two components that can improve over time: the static instruction text and a small set of few-shot trajectory examples. The learning loop collects episode trajectories, identifies what worked and what didn't, and uses that signal to update both components.

This is sometimes called in-context RL or rejection-sampling fine-tuning applied at the prompt level. It's the right fit here because:
- Episodes are short and episodic (clear start/end, clean return signal)
- The reward signal is already shaped (turn penalties + terminal outcome)
- The environment is stable enough that a few good demonstrations meaningfully improve prompt-level behavior
- It produces interpretable updates — you can read the prompt and see what changed

---

## Three components

### 1. Trajectory collection

Every episode produces a trajectory: the full sequence of `(state, action, reward)` tuples plus the final return. These are written to a JSONL log so they persist across runs and can be queried.

Each trajectory record stores:
- Episode metadata: task type, difficulty, persona, query style
- Turn-by-turn sequence: action taken, voice agent response, reward delta
- Episode outcome: total return, success/failure, failure reason if applicable
- Policy version: which prompt generation produced this trajectory

The JSONL format means any episode can be replayed, filtered by outcome, or fed back into the prompt.

### 2. Policy improvement

At the end of a training generation (N episodes), the policy updater runs two passes:

**Positive reinforcement — few-shot examples**
Select the top-K highest-return trajectories and add them to the system prompt as demonstrations. The caller sees concrete examples of efficient, successful episodes before it acts. Limit to 2–3 examples to avoid prompt bloat; prefer examples that cover different task types and failure modes navigated correctly.

**Failure analysis — targeted guidance**
Identify the most common failure pattern in the generation. The actionable signals are:

- **WRONG_ANSWER rate** — caller is submitting before it has enough information; add guidance on confidence threshold before submitting
- **CALL_ENDED_NO_ANSWER rate** — caller is hanging up without extracting the answer; add guidance on persistence
- **Disambiguation loop turns** — caller is burning turns on back-and-forth before resolving which account is being discussed; add guidance on leading with the contact's full name
- **Recovery rate after failed call attempts** — fraction of episodes where the call failed (answering machine, wrong number, no answer) and the caller ultimately succeeded by retrying; low recovery rate means the caller is giving up too early

Note: the raw frequency of ANSWERING_MACHINE / WRONG_NUMBER / NO_ANSWER outcomes is not a policy signal. Those outcomes are drawn from fixed environment probabilities (10% / 5% / 5%) and are independent of what the caller does. What the caller *can* learn is whether to retry after a failure — and that is captured by recovery rate, measured from the action sequence in the trajectory log, not from the failure label itself.

Add a short, specific instruction to the system prompt addressing the dominant failure pattern. One targeted rule per generation is enough — stacking too many rules quickly degrades prompt quality.

The updated prompt becomes the policy for the next generation. The previous prompt is archived so improvement can be measured.

### 3. Evaluation

Three evaluation modes, each serving a distinct purpose:

**Golden suite (regression anchor)**
`npm run golden` runs the same 5 fixed scenarios every generation. This is the floor — the policy must not get worse on known scenarios. If golden pass rate drops, the update is rejected. All 5 tasks are solvable in 2 turns; a healthy policy should hold 5/5 at +9 throughout training.

**Stress suite (improvement signal)**
`npm run stress` runs 8 adversarial scenarios designed to expose known failure modes. Unlike the golden suite, some failures here are expected — the metric is reward score, not pass/fail. The suite targets four failure modes, two scenarios each:

| Scenarios | Failure mode targeted |
|-----------|----------------------|
| S1, S2 | First-name-only disambiguation: agent has no last name, must resolve from contextual clues |
| S3, S4 | Partial company name: agent dials a shortened name, voice agent must resolve |
| S5, S6 | Edge-case field values: empty renewal date ("No renewal date on file"), zero contract value ("No contract on file") |
| S7 | No-clue disambiguation: first name only, no role or company hint — hardest path |
| S8 | Verify-style turn inflation: "confirm" framing encourages extra turns |

Baseline (first run): 6/8 passed, avg reward +4.3. A prompt improvement should move both pass rate and avg reward upward. If S1/S2 reward increases, disambiguation strategy is improving. If S7 moves from fail to pass, the caller has learned to ask about distinguishing account characteristics rather than contact roles.

**Generation metrics**
After each training generation, record: success rate, average return, average turns, and per-task-type breakdown. Plot these across generations to produce the learning curve. A meaningful improvement is a consistent rise in success rate across at least two consecutive generations, not a single lucky run.

---

### How pass/fail and reward relate

Pass/fail is purely answer correctness: an episode passes if a value was submitted and it matches the target after normalization. It does not account for how many turns it took or how much reward was spent getting there. An episode that passes at +2 (correct answer after 6 expensive turns) and one that passes at +8 (correct answer after 2 turns) look identical in pass/fail reporting.

**Reward is the right signal to optimize.** Pass/fail is a coarse proxy that misses the turn-efficiency dimension the penalty structure is designed to surface. Use pass rate as a sanity check (is the policy staying above baseline?), but track average return as the primary learning signal. A prompt update that holds pass rate flat while improving average return is a genuine improvement — it means the agent is getting correct answers more efficiently.

---

## Training loop structure

```
Generation 0: baseline prompt, N episodes → trajectories logged
  ↓
Policy update: select top-K examples + identify failure pattern
  ↓
Generation 1: updated prompt, N episodes → trajectories logged
  ↓
Policy update: ...
  ↓
...
  ↓
Golden suite: run after each generation, reject update if regression
```

A generation is 10–20 episodes — enough to see a failure pattern, not so many that a bad prompt wastes API budget. Start at 10.

---

## What success looks like

A working learning loop should show, over 3–5 generations:
- Success rate on training episodes trending upward from baseline (expect ~70–80% at generation 0 on easy tasks)
- Average turns decreasing as the caller learns to ask directly
- Stress suite avg reward increasing from the +4.3 baseline, particularly S1/S2 (disambiguation) and S7 (no-clue)
- Recovery rate after failed call attempts trending upward, as the caller learns to retry rather than quit

The metrics that are *not* meaningful signals: the raw frequency of ANSWERING_MACHINE, WRONG_NUMBER, and NO_ANSWER outcomes. These are drawn from fixed environment probabilities (10%/5%/5%) and will be noise at any sample size a training generation provides. Don't include them in the learning curve — they'll obscure real signal.

The golden suite staying at 5/5 throughout is the integrity check. If the prompt is improving on training tasks but regressing on golden tasks, the policy is overfitting to the recent trajectory sample.

---

## Implementation plan

Three new pieces, in order:

1. **`src/runner/trajectory-store.ts`** — append-only JSONL writer; `save(trajectory)`, `loadAll()`, `loadByGeneration(n)`, `loadTopK(k)`
2. **`src/runner/policy-updater.ts`** — `selectExamples(trajectories, k)`, `analyzeFailures(trajectories)`, `buildPrompt(base, examples, guidance)`
3. **`src/training-run.ts`** — the outer loop: run a generation, call the updater, write updated prompt, repeat for G generations, run golden suite at the end

`LLMAgent` gets a `setPrompt(prompt: string)` method so the training loop can inject the updated prompt between generations without reconstructing the agent.
