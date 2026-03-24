# Evaluation Guide

Two run modes exist: **golden** (static, deterministic, comparable across runs) and **training** (randomised, varied, for exploring the task distribution).

---

## Golden suite — `npm run golden`

Runs five fixed scenarios against known accounts with all call outcomes forced to ANSWERED. Every run tests the same tasks in the same order, so results are directly comparable across agent versions, prompt changes, or model swaps.

```
npm run golden
```

Exits 0 if all five pass, non-zero otherwise — suitable for CI.

**What the five tasks cover:**

| # | Type | Field | Company / Contact | Persona | Style |
|---|------|-------|-------------------|---------|-------|
| 1 | SIMPLE_LOOKUP | contract_value | Acme Corp | professional | direct |
| 2 | SIMPLE_LOOKUP | contract_renewal_date | Globex Corporation | casual | conversational |
| 3 | SIMPLE_LOOKUP | deal_stage | Umbrella Technologies | assertive | direct |
| 4 | DISAMBIGUATION | account_status | Sarah Johnson → Initech Solutions | professional | direct |
| 5 | DISAMBIGUATION | last_activity | Sarah Waugh → Soylent Corp | casual | verify |

The five tasks are intentional: they span every queryable field type (numeric, date, string enum, status), both task types, and three of the four caller personas. Running golden after any change to the agent, voice agent, or reward logic tells you immediately whether baseline behaviour held.

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
Each `speak` costs −1. `initiate_call` also costs −1. `submit_answer` and `end_call` do not.

**Episode summary box** shows the submitted answer vs the target value, outcome (SUCCESS / FAILURE), failure reason if applicable, and total reward for the episode.

**Run summary** (printed after all episodes) shows success rate, average reward, average turns, and a per-task-type breakdown — the key metric for comparing agent versions or prompt changes.

---

## Reward reference

| Event | Delta | When it fires |
|-------|-------|---------------|
| `CORRECT_ANSWER` | +10 | `submit_answer` value matches ground truth |
| `WRONG_ANSWER` | −5 | `submit_answer` value does not match |
| `CALL_ENDED_NO_ANSWER` | −3 | `end_call` without submitting |
| `ANSWERING_MACHINE` | −2 | `initiate_call` hits answering machine |
| `WRONG_NUMBER` | −2 | `initiate_call` hits wrong number |
| `TURN_PENALTY` | −1 | every `initiate_call` or `speak` |

A perfect SIMPLE_LOOKUP episode (one `initiate_call`, one `speak`, correct `submit_answer`) scores **+8**: +10 −1 −1.
