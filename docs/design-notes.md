# Voice Agent RL Environment — Design Notes

## Data Model Assumptions

### How CRM data is used

`src/crm/data.json` is a single shared dataset serving two conceptually distinct purposes. First, it acts as the **ground truth for reward evaluation** — the environment compares the caller's submitted answer against the stored record. Second, it acts as the **voice agent's knowledge base** — when the voice agent receives a caller utterance, it queries the same store via MCP tools (`lookup_account`, `get_account_field`, `search_contacts`) to produce its response.

This means the voice agent will always give correct, consistent answers. The caller is always talking to a voice agent who has perfect, up-to-date knowledge of the same records the reward signal uses.

### Limitation this introduces

The shared data model collapses two knowledge systems into one. In reality, the vendor's CRM and the customer's understanding of their own account are often in disagreement — the customer may dispute a contract value, quote a different renewal date, or have no idea what "deal stage" means in the vendor's pipeline taxonomy. None of that divergence can exist here because both the reward signal and the voice agent read from the same source of truth. The caller is never tested against the core challenge of real outbound calls: reconciling what your system says with what the other party actually believes.

It also means the caller can never "learn something new" from a call. In a real deployment, the whole point of calling might be to discover that the CRM data is stale — the rep says "actually we renewed in February" and that's new information. Here, the voice agent will always confirm what the CRM already says.

### What a more complete separation would look like

A system that properly separates knowledge would maintain two distinct stores:

- **Caller-side (vendor CRM):** what the caller knows going into the call — possibly incomplete or stale. This is the context the caller uses to decide who to call and what to ask.
- **Voice agent-side (helpline knowledge):** what the voice agent can confirm — independently maintained, with intentional divergence. The voice agent might have a different contract value, be unaware of a deal stage the vendor assigned, or know about a renewal that hasn't been logged yet.

The reward signal would then evaluate against a separate oracle record. The most interesting tasks become those where the caller-side record and the voice agent's record disagree — the caller's job is to surface that divergence and extract the voice agent's version.

## MVP Decisions

### 1. LLM-Powered Voice Agent

**Current:** The voice agent is a Claude `claude-sonnet-4-6` instance (`src/voice-agent/voice-agent.ts`) that runs an internal agentic tool loop per caller utterance. When the caller speaks, the voice agent calls CRM MCP tools as needed (`lookup_account`, `search_contacts`, `get_account_field`), then returns a natural language response. Disambiguation is handled by the voice agent natively — it calls `search_contacts`, gets multiple matches, and asks the caller to clarify.

**A note on framing:** The voice agent is the *environment*, not the RL subject. "Improving" it means making it a better training surface for the caller — more challenging, more diverse, more realistic — not making it more capable in isolation. The evolutions below are ordered roughly from easiest to implement to most structurally complex.

**Stochastic errors:** Voice agent occasionally returns a plausible-but-wrong value (e.g., last year's contract value, a similar company's renewal date). Forces the caller to learn verification behaviors — asking follow-up questions or expressing uncertainty before submitting. Currently the voice agent is a perfect oracle; a caller that never verifies can still score perfectly, which is not a realistic policy.

**Partial / evasive responses:** Voice agent gives vague answers ("the contract is somewhere in the six figures") rather than exact values. Caller must learn to ask for precision. Tests whether the caller handles underspecified responses rather than just routing exact values to `submit_answer`.

**Persona / style variation:** Parameterize voice agent behavior across episodes — terse vs. verbose, proactive vs. guarded. Training against a fixed persona produces a caller that overfits to that style. Training against a *distribution* of personas produces a more robust caller policy. Sample persona parameters from a range at the start of each episode.

**Curriculum / adaptive difficulty:** Start with a cooperative, low-noise voice agent and ramp difficulty as the caller's success rate improves — increasing ambiguity, evasion rate, and disambiguation depth. Keeps the training signal in the informative zone throughout training. A simple implementation: bucket episodes into difficulty tiers and promote the caller when it hits a success rate threshold.

**Domain randomization:** Treat cooperation level, error rate, disambiguation threshold, and verbosity as environment parameters sampled from a distribution each episode (standard technique from sim-to-real transfer in robotics RL). The caller policy must generalize across this space rather than memorizing a single voice agent configuration.

**Adversarial voice agent (self-play):** Train the voice agent simultaneously with the caller — the voice agent is rewarded for making the caller fail while staying within a "realistic behavior" manifold; the caller is rewarded for succeeding. This co-evolutionary dynamic produces both a harder environment and a more robust caller. The constraint on realism is important: without it, the voice agent converges to gibberish or refusal, which is a degenerate equilibrium.

The `VoiceAgent.handleUtterance(text): Promise<string>` interface is the correct abstraction point for all of these. Swapping in a different voice agent implementation — parameterized, adversarial, or curriculum-controlled — requires no changes to the environment, runner, or caller.

---

### 2. Two-LLM Architecture (Caller + Voice Agent)

**Current:** Two separate Claude instances run per episode. The *external caller* (`LLMAgent`) uses hardcoded action tools (`initiate_call`, `speak`, `submit_answer`, `end_call`) and has no access to the CRM. The *voice agent* (`VoiceAgent`) has CRM MCP tools and no knowledge of the task or reward signal. They interact only through the text of the conversation.

This separation is the core architectural decision: MCP is the voice agent's internal tooling, not the caller's interface. The caller's action space is simple (speak or submit an answer); complexity lives in how the voice agent processes utterances and retrieves data.

**Future Evolution:** Expose voice agent performance metrics separately from caller performance metrics — track how often the voice agent correctly identifies the account on the first lookup, how often disambiguation is needed, and how many CRM tool calls the voice agent makes per utterance. This separates environment quality from caller skill, enabling targeted improvements to each layer independently.

---

### 3. MCP as Internal Voice Agent Tooling

**Current:** The CRM MCP server (`src/mcp/server.ts`) exposes three lookup tools used exclusively by the voice agent: `lookup_account` (search by company or contact name), `get_account_field` (retrieve a specific field by account ID), and `search_contacts` (search by contact name, useful for disambiguation). These run in-process via `InMemoryTransport`.

The caller never touches MCP. This means the caller cannot directly query the CRM — it can only extract information by asking the voice agent, who decides what to look up.

**Future Evolution:** Switch to `stdio` subprocess transport or SSE transport. This enables the MCP server to run as a standalone microservice, supports real MCP-compatible clients (e.g., Claude Desktop, Cursor), and allows the voice agent to run in a sandboxed subprocess. The `createCrmMcpPair()` factory already encapsulates the transport choice — swapping requires changing only that function.

---

### 4. LLM Evaluation Loop (No Weight Updates)

**Current:** Claude `claude-sonnet-4-6` is evaluated over N episodes in a pure inference loop. There are no gradient updates, policy optimization, or experience replay. The `VoiceAgentEnv` provides `reset()`, `step()`, and `reward` — but these are only used for logging, not for learning.

**Future Evolution:** The `VoiceAgentEnv.reset()`/`step()`/`reward` interface is already Gym-compatible in spirit. Adding REINFORCE or PPO over the caller's action space is straightforward: collect `(state, action, reward)` tuples per episode, compute policy gradients over the action type and argument selections, and fine-tune a smaller model with RL. The `EpisodeResult.rewardBreakdown` provides a structured signal for credit assignment.

---

### 5. Static Failure Mode Probabilities

**Current:** Each `initiate_call` outcome is drawn from a fixed distribution: 80% ANSWERED, 10% ANSWERING_MACHINE, 5% WRONG_NUMBER, 5% NO_ANSWER. This is independent of which account is being called, the time of day, or the caller's history. Failure outcomes (ANSWERING_MACHINE, WRONG_NUMBER) apply a reward penalty but do not end the episode — the caller can retry.

**Future Evolution:** Condition failure probabilities on account attributes: e.g., `at_risk` accounts have higher NO_ANSWER rates, churned accounts always go to ANSWERING_MACHINE. This creates a richer exploration-exploitation tradeoff where the caller must learn which companies are worth retrying.

---

### 6. In-Process MCP via InMemoryTransport

See MVP Decision #3 above — the transport choice and its evolution path are documented there.

---

### 7. Terminal-Only Observability

**Current:** All episode data is logged to stdout using chalk-colored text — caller actions in cyan, voice agent responses in yellow, reward deltas in green/red, and episode summaries in bordered boxes. There is no persistent log storage and no way to replay episodes after the run.

**Future Evolution:** Emit structured JSONL episode logs alongside chalk output (one JSON line per step, one per episode). Build a lightweight Hono server that reads the JSONL log and serves a browser dashboard with episode replay, reward curves, and per-task-type breakdown charts. The `EpisodeResult` type already contains all the data needed for replay.

---

### 8. Text-Based Dialogue (No Voice)

**Current:** `VoiceAgent.handleUtterance()` accepts plain text strings and returns plain text strings. There is no audio I/O — the "voice agent" is voice in concept only.

**Future Evolution:** Wrap the I/O boundary with Whisper STT (audio to text) on the input side and ElevenLabs TTS (text to audio) on the output side. Because `handleUtterance()` is already a string-in/string-out boundary, no voice agent or environment changes are needed — only the entry-point orchestration changes.

---

### 9. Single Agent (Claude)

**Current:** `LLMAgent` implements the `Agent` interface using `claude-sonnet-4-6` via the Anthropic SDK. Only one caller agent is evaluated per run.

**Future Evolution:** The `Agent` interface (`act(state): Promise<AgentAction>`, `reset(task): void`) is intentionally minimal and swappable. Adding a GPT-4o caller, Gemini caller, or rule-based baseline requires only implementing this interface. The `runEpisodes()` function accepts any `Agent`, enabling side-by-side A/B comparisons across agent versions with the same task set and reward function.

---

### 10. No Task Seeding / Reproducibility

**Current:** Tasks and call failure outcomes are generated using `Math.random()` with no seeding. Two runs with the same `N_EPISODES` will produce different task distributions and different call outcomes, making it impossible to compare agent versions on exactly the same evaluation set.

**Future Evolution:** Accept a `--seed` CLI flag and replace `Math.random()` with a seeded PRNG. Store the seed alongside episode logs so any run can be reproduced exactly. This is essential for ablation studies and A/B comparisons.

---

### 11. Exact/Normalized Answer Matching

**Current:** Submitted answers are normalized (lowercase, strip `$`, `,`, `_`, whitespace) and compared with `===`, with a numeric tolerance of `0.01` for float comparisons. The voice agent is instructed to return data values exactly as stored to minimize format mismatch. This handles common variants (`$120,000` vs `120000`) but is fragile for natural language phrasings.

**Future Evolution:** Use an LLM-as-judge for free-form answer evaluation. Given the target value and the submitted value, ask Claude: "Are these semantically equivalent answers for the field `contract_renewal_date`?" This handles date format variations, abbreviations, and rounding differences without hand-crafting normalization rules per field type.

---

## Reward Landscape

### Where Agents Succeed

**SIMPLE_LOOKUP tasks with exact company name matches** are the easiest scenario. The call connects (80% probability), the voice agent resolves the account unambiguously and returns the field value in a single response, and the caller submits the answer. Typical reward: +9 (+10 correct answer, -1 for the single speak turn; the first dial is free).

**DISAMBIGUATION tasks** that provide the contact's full name are also reliably solved. The caller speaks the full name ("Sarah Chen"), the voice agent calls `search_contacts("Sarah Chen")` which returns a single match, and it answers immediately. This requires only one speak turn — same efficiency as SIMPLE_LOOKUP.

### Where Agents Get Stuck

**DISAMBIGUATION with first name only** is harder. If the caller only says "Sarah", the voice agent's `search_contacts` returns multiple matches and it asks for clarification. The caller must then specify a company name — but it only knows the contact's full name, not the company. The caller needs to match "Sarah Chen" to "Globex Corporation" from the voice agent's disambiguation list, which requires reasoning across turns.

**Date and value format mismatches** can cause WRONG_ANSWER submissions if the caller submits the voice agent's response verbatim but that phrasing doesn't normalize to the stored value. The voice agent is instructed to return raw values, but an LLM may still reformat.

### Failure Attractors

**Answering machine without retry:** Callers that receive ANSWERING_MACHINE and immediately call `end_call` accept a -3 total reward when a retry could eventually connect. Optimal behavior is to retry `initiate_call` once or twice before giving up.

**Wrong field value submission:** Callers that submit the wrong field (e.g., `deal_stage` when asked for `contract_value`) receive -5 WRONG_ANSWER — worse than `end_call` (-3 CALL_ENDED_NO_ANSWER). This creates a risk-reward tradeoff around answer confidence.

### The Turn Penalty Pressure

The -1/turn penalty creates pressure toward efficiency but can cause **premature `submit_answer` calls** with low-confidence answers. A caller that has received one ambiguous voice agent response may guess rather than paying another turn to clarify — trading a possible -5 WRONG_ANSWER for a possible +10 CORRECT_ANSWER. This is the core exploration/exploitation tension in the reward structure.
