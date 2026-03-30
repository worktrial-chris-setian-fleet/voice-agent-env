# Evaluation Guide

The repo currently supports four evaluation workflows:

- **Golden** — fixed regression suite, deterministic call outcomes
- **Stress** — fixed adversarial suite, deterministic call outcomes
- **Random** — sampled episodes from the task distribution
- **Experiment loop** — baseline vs candidate policy evaluation with stored artifacts and comparisons

---

## Golden suite — `npm run golden`

Runs six fixed scenarios against known accounts with all call outcomes forced to ANSWERED. Every run tests the same tasks in the same order, so results are directly comparable across agent versions, prompt changes, or model swaps.

```
npm run golden
```

Exits 0 if all six pass, non-zero otherwise — suitable for CI.

**What the six tasks cover:**

| # | Type | Field | Company / Contact | Persona | Style |
|---|------|-------|-------------------|---------|-------|
| 1 | SIMPLE_LOOKUP | contract_value | Acme Corp | professional | direct |
| 2 | SIMPLE_LOOKUP | contract_renewal_date | Globex Corporation | casual | conversational |
| 3 | SIMPLE_LOOKUP | deal_stage | Umbrella Technologies | assertive | direct |
| 4 | DISAMBIGUATION | account_status | Sarah Johnson → Initech Solutions | professional | direct |
| 5 | DISAMBIGUATION | last_activity | Sarah Waugh → Soylent Corp | casual | verify |
| 6 | RESOLVE_THEN_RETRIEVE | contract_value | "Technologies" + account_status=active → Umbrella Technologies | professional | verify |

The six tasks are intentional: they span every queryable field type (numeric, date, string enum, status), all three task types, and three of the four caller personas. Running golden after any change to the agent, voice agent, or reward logic tells you immediately whether baseline behaviour held.

---

## Stress suite — `npm run stress`

Runs eight fixed adversarial scenarios chosen to expose known failure modes. Like golden, all call outcomes are forced to `ANSWERED` so the suite is comparable across runs, but unlike golden the goal is not necessarily 8/8 pass rate. Stress is most useful as a reward and behavior benchmark.

```bash
npm run stress
```

The current stress set includes:
- deep first-name-only disambiguation
- ambiguous company fragments like `"Technologies"` or `"Corp"`
- no-clue contact resolution
- multistep resolve-then-retrieve chains

---

## Random runs — `npm start`

Runs N randomly generated episodes. Tasks are sampled from the full distribution of task types, difficulty levels, caller personas, and query styles on every run — no two runs are identical.

```bash
npm start                    # 5 episodes (default)
npm start -- --episodes 10   # custom episode count
N_EPISODES=20 npm start      # via env var
```

Use training runs to explore how the agent handles the full task space, stress-test edge cases, and collect reward statistics across many episodes.

Random runs keep the environment's probabilistic call routing, so `ANSWERING_MACHINE`, `WRONG_NUMBER`, and `NO_ANSWER` can still occur.

---

## Experiment loop

The repo also supports prompt-version experiments backed by persisted artifacts under `artifacts/`.

```bash
npm run experiment:init -- --label "prompt-iter-1"
npm run experiment:step -- --experiment <experiment-id> --updater llm
npm run experiment:loop -- --experiment <experiment-id> --iterations 3 --updater llm
npm run experiment:show -- --experiment <experiment-id>
npm run policy:show -- --experiment <experiment-id> --policy <policy-id>
npm run viewer
```

`experiment:step` evaluates the current policy, creates a candidate prompt, evaluates the candidate on the configured suites, stores summaries/trajectories/comparisons, and promotes the candidate if it clears the comparison gate.

---

## Task variation dimensions

Every generated task is a combination of four independently sampled dimensions. Understanding them helps interpret why an agent might succeed on one run and fail on another.

### Type
- **SIMPLE_LOOKUP** — caller knows the company name; one call, one question is sufficient.
- **DISAMBIGUATION** — caller only has a contact first name ("Sarah"); the voice agent may return multiple matches and ask for clarification before it can answer.
- **RESOLVE_THEN_RETRIEVE** — caller has a partial identity plus one or more clues (for example, account status or deal stage) and must identify the correct account before retrieving the final target field.

### Difficulty
Controls what name the caller uses in `initiate_call`:
- **easy** — exact full company name (`"Acme Corp"`)
- **medium / hard** — first word only (`"Acme"`), requiring the voice agent to resolve a partial match

### Caller persona
Appended to the task description to shape how the LLM caller phrases its questions:

| Persona | Instruction appended |
|---------|----------------------|
| `professional` | Be concise and professional. |
| `casual` | Keep it casual and friendly. |
| `assertive` | Be direct and efficient — no small talk, just the data. |
| `uncertain` | You are not sure of all the details — ask clarifying questions as needed. |

### Query style
Frames the goal itself:

| Style | Example phrasing |
|-------|-----------------|
| `direct` | *Find the contract value for "Acme Corp".* |
| `conversational` | *Give Acme Corp a quick call and ask about their contract value.* |
| `verify` | *Verify the contract value currently on file for Acme Corp — call to confirm.* |

---

## Reading the output

**Per-turn output:**
```
[Turn 2] CALLER → speak(utterance="What is the contract renewal date?")
  VOICE AGENT: The contract renewal date is 2026-09-15.
  Reward: -1 [TURN_PENALTY]
```
Each `speak` costs −1. The first `initiate_call` is free; retry dial attempts cost −1. `submit_answer` and `end_call` do not.

On `RESOLVE_THEN_RETRIEVE` tasks, the environment also logs intermediate multistep progress:
- resolution clues confirmed
- when the account has been resolved and the environment is waiting on a second caller action
- whether the target field was actually observed before submit

On ambiguity-heavy tasks, the runner now also logs **caller-side disambiguation evaluation**:
- good disambiguation question
- premature target request
- redundant clarification

These caller-behavior labels now drive the intermediate shaping reward. Voice-agent progress events remain in the logs as diagnostics, but they no longer contribute intermediate reward.

**Episode summary box** shows the submitted answer vs the target value, outcome (SUCCESS / FAILURE), failure reason if applicable, and total reward for the episode.

**Run summary** (printed after all episodes) shows success rate, average reward, average turns, a per-task-type breakdown, multistep diagnostics, and a compact caller-behavior section focused on:
- good disambiguation question rate
- premature target request rate
- average turns to resolution

---

## Reward reference

| Event | Delta | When it fires |
|-------|-------|---------------|
| `CORRECT_ANSWER` | +10 | `submit_answer` field and value both match ground truth |
| `WRONG_ANSWER` | −5 | `submit_answer` field or value does not match |
| `CALL_ENDED_NO_ANSWER` | −3 | `end_call` without submitting |
| `ANSWERING_MACHINE` | −2 | `initiate_call` hits answering machine |
| `WRONG_NUMBER` | −2 | `initiate_call` hits wrong number |
| `INVALID_ACTION` | −2 | caller uses an action that is illegal in the current call state |
| `GOOD_DISAMBIGUATION_QUESTION` | +1 | caller asks a useful distinguishing question while ambiguity is still active |
| `PREMATURE_TARGET_REQUEST` | −1 | caller asks for the target field before resolving which account/contact is meant |
| `REDUNDANT_DISAMBIGUATION` | −1 | caller repeats a clarification dimension that was already used |
| `TURN_PENALTY` | −1 / −2 / −3 | every `speak` and every retry `initiate_call` after the first; escalates as penalized turns accumulate |

A perfect SIMPLE_LOOKUP episode (one free `initiate_call`, one `speak`, correct `submit_answer`) scores **+9**: +10 −1.
A clean single-clue RESOLVE_THEN_RETRIEVE episode with one good resolving question and one follow-up retrieval turn scores **+9**: +10 +1 −1 −1.
