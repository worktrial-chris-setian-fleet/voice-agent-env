# Evaluation Guide

Two run modes exist: **golden** (static, deterministic, comparable across runs) and **training** (randomised, varied, for exploring the task distribution).

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

## Training runs — `npm start`

Runs N randomly generated episodes. Tasks are sampled from the full distribution of task types, difficulty levels, caller personas, and query styles on every run — no two runs are identical.

```bash
npm start                    # 5 episodes (default)
npm start -- --episodes 10   # custom episode count
N_EPISODES=20 npm start      # via env var
```

Use training runs to explore how the agent handles the full task space, stress-test edge cases, and collect reward statistics across many episodes.

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

These caller-behavior labels are instrumentation only in the current phase. They are intended to support a future reward shift away from voice-agent-derived intermediate credit.

**Episode summary box** shows the submitted answer vs the target value, outcome (SUCCESS / FAILURE), failure reason if applicable, and total reward for the episode.

**Run summary** (printed after all episodes) shows success rate, average reward, average turns, a per-task-type breakdown, multistep progress, and a compact caller-behavior section for ambiguous tasks.

---

## Reward reference

| Event | Delta | When it fires |
|-------|-------|---------------|
| `CORRECT_ANSWER` | +10 | `submit_answer` field and value both match ground truth |
| `WRONG_ANSWER` | −5 | `submit_answer` field or value does not match |
| `CALL_ENDED_NO_ANSWER` | −3 | `end_call` without submitting |
| `ANSWERING_MACHINE` | −2 | `initiate_call` hits answering machine |
| `WRONG_NUMBER` | −2 | `initiate_call` hits wrong number |
| `RESOLUTION_CLUE_CONFIRMED` | +1 | a multistep clue is confirmed for the target account |
| `TARGET_FIELD_OBSERVED` | +1 | the multistep target field is observed for the target account before submit |
| `TURN_PENALTY` | −1 | every `speak` and every retry `initiate_call` after the first |

A perfect SIMPLE_LOOKUP episode (one free `initiate_call`, one `speak`, correct `submit_answer`) scores **+9**: +10 −1.
A perfect single-clue RESOLVE_THEN_RETRIEVE episode scores **+11**: +10 +1 +1 −1.
