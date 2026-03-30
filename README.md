# voice-agent-env

A simulated RL environment where an LLM-powered agent makes outbound calls to a CRM helpline to retrieve account information. The environment is designed for evaluating and training the *caller* — the agent that learns to ask the right questions efficiently.

## How it works

Three actors, each with a distinct role:

- **External caller** (`LLMAgent`) — the RL subject. Makes calls, asks questions, submits answers. Rewarded for correct retrievals, penalised for wasted turns and call failures.
- **Voice agent** (internal to the environment) — answers inbound calls and uses CRM tools to look up data. Not being trained — it is the environment.
- **CRM** — 30 accounts with fields like contract value, deal stage, and renewal date. Exposed to the voice agent via MCP tools; never directly accessible to the caller.

The caller can only extract information through conversation. The reward signal shapes it toward efficient, accurate retrieval.

## Quickstart

```bash
npm install
printf 'ANTHROPIC_API_KEY=your_key_here\n' > .env
npm start                  # 5 random episodes
npm start -- --episodes 10 # custom count
npm run golden             # 6 fixed regression scenarios
npm run stress             # 8 adversarial scenarios
npm run experiment:init -- --label "baseline-pass"
npm run experiment:loop -- --experiment <experiment-id> --iterations 3 --updater llm # policy experiment quickstart
npm run viewer             # browser viewer for run artifacts
```

`npm run golden` exits non-zero if any scenario fails — use it after changes to verify nothing regressed.

Open `http://localhost:4173` after starting the viewer.

## Task types

| Type | Description |
|------|-------------|
| `SIMPLE_LOOKUP` | Caller knows the company name; one call and one question is sufficient. |
| `DISAMBIGUATION` | Caller only has a contact first name shared across multiple accounts; must narrow down through conversation. |
| `RESOLVE_THEN_RETRIEVE` | Caller has a partial identity plus one or more clues, and must identify the correct account before retrieving the final target field. |

Tasks are also varied across **difficulty** (exact name vs. partial), **caller persona** (professional / casual / assertive / uncertain), and **query style** (direct / conversational / verify). See [`docs/evaluation.md`](docs/evaluation.md) for the full breakdown.

## Reward

| Event | Delta |
|-------|-------|
| Correct answer | +10 |
| Wrong answer | −5 |
| End call without answer | −3 |
| Answering machine / wrong number | −2 |
| Invalid action | −2 |
| Good disambiguation question | +1 |
| Premature target request | −1 |
| Redundant disambiguation | −1 |
| Each `speak`, and each retry dial after the first | starts at −1, escalates on long episodes |

A perfect episode — one free dial, one question, correct answer — scores **+9**.
A clean multistep episode typically lands around **+8 to +10**, depending on whether the caller earns or burns shaping reward while resolving ambiguity.

---

## Reward landscape

The −1/turn penalty creates constant pressure toward efficiency. The interesting tension is between that pressure and answer confidence: the agent can always guess early and risk a −5 wrong answer, or spend more turns to be certain. This is the core exploration/exploitation tradeoff the reward structure is designed to surface.

**Where agents get stuck:**
- **Answering machine without retry** — treating a failed call as the end of the episode rather than retrying, leaving reward on the table
- **Disambiguation loops** — asking for information before resolving which account is being discussed, causing the voice agent to re-prompt and burning turns
- **Resolve-then-retrieve collapse** — identifying the right account but failing to chain through to the final requested field
- **Premature submission** — submitting a low-confidence answer to avoid another turn penalty, trading a likely +9 for a possible −6

Detailed analysis in [`docs/design-notes.md → Reward Landscape`](docs/design-notes.md#reward-landscape).

---

## Docs

| File | What's in it |
|------|-------------|
| [`docs/evaluation.md`](docs/evaluation.md) | Run modes, task dimensions, reading the output, reward reference |
| [`docs/design-notes.md`](docs/design-notes.md) | Architecture decisions, tradeoffs, and future evolution paths |
| [`docs/eval-framework.md`](docs/eval-framework.md) | Prompt-optimization and experiment loop notes |
| [`docs/architecture.mmd`](docs/architecture.mmd) | Mermaid diagram of the full system |
| [`docs/problem-statement.md`](docs/problem-statement.md) | Original project brief |

---

## Approach, tradeoffs, and what's next

### Approach

The first decision was where to draw the boundary between the environment and the agent being trained. The problem statement describes a voice agent that makes calls — but on reflection, that framing conflates two distinct roles. The entity being trained is the *caller*: it calls in to extract information it doesn't have. The entity answering the call is the *voice agent*: it has CRM access and responds to questions. Keeping those roles separate meant the RL boundary became clean — the caller's policy is entirely about how to have a conversation, not about how to query a database.

From there the architecture fell out naturally. MCP became the voice agent's internal tooling rather than the caller's action space. The caller's actions are simple (speak, submit, hang up); the voice agent runs its own agentic tool loop on each utterance to look up whatever it needs. The environment wraps all of this and exposes a `reset` / `step` / `reward` interface to the training loop.

For the agent itself, I used Claude as an LLM-in-the-loop rather than a learned policy. This produces observable, interpretable behavior immediately and lets the environment design be validated before committing to a training setup. The conversation history and action structure are already shaped for a future policy gradient step.

### Tradeoffs

**The voice agent is a perfect oracle.** The CRM data feeds both the voice agent's responses and the reward evaluator — they share the same JSON. This collapses what would be two distinct knowledge systems in a real deployment: what the vendor's CRM says and what the customer actually believes. The simulation is clean but it means the caller is never tested against the core real-world challenge of reconciling conflicting information. Separating the two data stores is the highest-value environment improvement.

**No weight-level RL yet.** There are still no gradient updates or model fine-tuning steps. What the repo does have now is prompt-level iteration: runs persist artifacts, and experiments can use those artifacts to propose and evaluate candidate prompt revisions. That keeps the environment as the focus while still allowing policy improvement without a full RL stack.

**Scripted failure modes over a learned adversary.** Call routing outcomes (answering machine, wrong number) are drawn from fixed probabilities. The voice agent doesn't make mistakes or give evasive answers. This keeps the environment predictable while the core loop is being validated, but it limits what the caller's policy needs to learn. A voice agent that occasionally gives partial or incorrect answers would force the caller to develop verification strategies — currently it can score well without them.

### What's next

The most impactful changes, roughly in order:

1. **Make the voice agent fallible.** Introduce stochastic errors, partial answers, and evasive responses. This is the single biggest change to the training surface and requires no changes outside `VoiceAgent.handleUtterance`.

2. **Separate the data stores.** Give the voice agent its own view of account data, independent from the reward evaluator's ground truth. The caller's job becomes surfacing disagreements between the two, which is what real account management calls actually involve.

3. **Add a learning step.** Collect `(state, action, reward)` tuples and run REINFORCE or PPO over the caller's action space. The environment interface is already compatible — this is additive, not structural.

4. **Real voice I/O.** The boundary is `handleUtterance(text): Promise<{ text, events }>`: caller-facing text plus environment-only trace metadata. Wrapping the input with Whisper STT and the output text with ElevenLabs TTS is still the only change needed to run the environment with real audio. Everything else — the caller, the environment, the reward logic — stays the same.
