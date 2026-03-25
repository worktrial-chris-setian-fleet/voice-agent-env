# Architecture Workstreams

This file is the coordination point for the next architecture pass. It is meant to let separate Codex threads or sub-agents work on one concern at a time without losing the key decisions from prior discussion.

## Current Baseline

- Repo: `voice-agent-env`
- Current architecture: caller agent -> voice agent -> MCP -> CRM
- Keep this architecture. The caller is still the RL subject. The voice agent remains an environment-side interlocutor that uses MCP as its internal CRM interface.
- Recent checkpoint: `RESOLVE_THEN_RETRIEVE` now supports a natural second caller action before final retrieval. The environment can distinguish resolution from retrieval and logs multistep progress.
- These architecture workstreams are now implemented:
  - public/private caller boundary via `ScenarioSpec`, `CallerBrief`, and `EpisodeObservation`
  - explicit action validation with invalid-action penalties
  - semantic voice-agent events plus preserved raw tool traces
  - scenario-family builders under `src/env/scenarios/`
- Next major phase after these workstreams: policy versioning and trajectory storage.

## Status

1. Public vs private environment boundary: complete
2. Scenario / task-family architecture: complete
3. Semantic event model: complete
4. Environment action validation / state machine: complete

## Cross-Cutting Constraints

- Preserve the current top-level architecture unless a change clearly improves the contract without changing the system story.
- Prefer small, explicit abstractions over framework-heavy generalization.
- Optimize for RL integrity, extensibility, and readability.
- Do not overfit to the current three task families if a more general concept is only slightly more work.
- Avoid introducing abstractions that make policy versioning harder to layer in next.

---

## Workstream 1: Public vs Private Environment Boundary

### Goal

Separate hidden scenario ground truth from the caller-visible task brief and observation state.

### Why This Matters

Right now the type system allows the agent boundary to see fields that should be private to the environment, such as target value and target account ID. Even if the current caller does not exploit them, the contract is unsafe for RL evaluation and for future policy backends.

### Key Prior Points

- The environment should own ground truth.
- The caller should only receive the task brief and observable state.
- This is the highest-value architecture cleanup before policy versioning work.

### Likely Deliverables

- Introduce separate concepts such as:
  - `ScenarioSpec` or equivalent private scenario type
  - `CallerBrief` or equivalent caller-visible reset payload
  - `EpisodeObservation` or equivalent caller-visible step state
- Update the `Agent` interface to consume only caller-visible data.
- Ensure episode evaluation still has access to hidden ground truth without leaking it across the agent boundary.

### Ready-To-Use Brief

```md
Context checkpoint:
- Repo: voice-agent-env
- Current architecture: caller agent -> voice agent -> MCP -> CRM
- Prior conclusion: keep this architecture
- Focus for this thread: public vs private environment boundary
- Important prior points:
  - RL integrity depends on separating hidden scenario ground truth from caller-visible state.
  - `Agent.reset()` and `Agent.act()` should not receive `targetValue`, `targetAccountId`, or other hidden fields by type.
  - Keep the existing runtime behavior where possible; this is primarily a contract cleanup.
- Do / don’t:
  - Do propose and implement a cleaner type/interface boundary.
  - Do preserve the caller -> voice agent -> MCP layering.
  - Don’t work on policy versioning yet.
```

---

## Workstream 2: Scenario / Task-Family Architecture

### Goal

Make task-family behavior easier to extend without continuing to widen one overloaded `Task` type and scattering task-specific branching across the environment and voice agent.

### Why This Matters

The current system works, but `Task` is beginning to mix scenario spec, caller prompt details, and evaluation behavior. As more multistep tasks are added, that will become harder to read and reason about.

### Key Prior Points

- The current system should stay simple; no heavy plugin framework is needed.
- A small per-task-family controller layer is probably enough.
- The design should make it clearer where a task family defines:
  - prompt/brief generation
  - voice-agent session configuration
  - progress interpretation
  - completion / scoring rules

### Likely Deliverables

- Propose whether to introduce one controller/module per task family.
- Reduce branching inside `environment.ts` and `tasks.ts`.
- Clarify the relationship between:
  - hidden scenario spec
  - caller-visible brief
  - task-family-specific evaluation logic

### Ready-To-Use Brief

```md
Context checkpoint:
- Repo: voice-agent-env
- Current architecture: caller agent -> voice agent -> MCP -> CRM
- Prior conclusion: keep this architecture
- Focus for this thread: scenario / task-family architecture
- Important prior points:
  - `Task` is doing too much.
  - Task-specific branching currently lives across `tasks.ts`, `environment.ts`, and `voice-agent.ts`.
  - We want extensibility without overengineering.
- Do / don’t:
  - Do recommend a cleaner structure for task-family-specific logic.
  - Do prefer lightweight modules or controllers over a full plugin framework.
  - Don’t solve policy versioning in this thread.
```

---

## Workstream 3: Semantic Event Model

### Goal

Evolve the environment instrumentation from low-level tool-derived events to higher-level semantic events that better support progress scoring, replay, and future trajectory analysis.

### Why This Matters

The new `VoiceAgentEvent` layer is useful, but the environment still has to infer semantic meaning like “account resolved” by matching field retrievals against hidden task clues. That will get brittle as scenarios become more varied.

### Key Prior Points

- The event model is the right place to add extensibility for observability.
- The caller should still only see text; richer events are environment-only.
- Semantic events will help future JSONL trajectories, dashboards, and policy comparisons.

### Likely Deliverables

- Propose a semantic event union, likely including ideas like:
  - `clarification_requested`
  - `account_resolved`
  - `field_returned`
  - `follow_up_requested`
  - `lookup_failed`
- Decide whether raw tool events should still be preserved for debugging.
- Reduce environment-side reverse engineering of voice-agent behavior.

### Ready-To-Use Brief

```md
Context checkpoint:
- Repo: voice-agent-env
- Current architecture: caller agent -> voice agent -> MCP -> CRM
- Prior conclusion: keep this architecture
- Focus for this thread: semantic event model
- Important prior points:
  - The current `VoiceAgentEvent` model is helpful but still low-level.
  - The environment should not have to reconstruct high-level behavior from raw tool outputs forever.
  - Richer semantic events will be useful for later trajectory storage and policy comparison.
- Do / don’t:
  - Do design a semantic event model that stays environment-only.
  - Do preserve debuggability if raw tool events are still useful.
  - Don’t turn this into a giant observability platform yet.
```

---

## Workstream 4: Environment Action Validation / State Machine

### Goal

Make environment transitions stricter and more explicit so the RL loop has a trustworthy action/state contract.

### Why This Matters

`step()` currently accepts more behavior than it should. That makes the environment easier to get started with, but weaker as a real RL environment and harder to reason about in later trajectory analysis.

### Key Prior Points

- Action legality should depend on call state.
- Invalid actions should produce explicit handling, not silently flow through.
- This should stay simple and readable; a small validator or reducer-style layer is enough.

### Likely Deliverables

- Introduce explicit action validation against `callState`.
- Decide how invalid actions should be treated:
  - reject with error
  - treat as no-op with penalty
  - terminate episode with penalty
- Make transition rules easier to read and test.

### Ready-To-Use Brief

```md
Context checkpoint:
- Repo: voice-agent-env
- Current architecture: caller agent -> voice agent -> MCP -> CRM
- Prior conclusion: keep this architecture
- Focus for this thread: environment action validation / state machine
- Important prior points:
  - `step()` should enforce legal actions for each call state.
  - This improves RL integrity and later trajectory analysis.
  - We want a principled transition model without introducing unnecessary abstraction.
- Do / don’t:
  - Do propose a clean validation/state-transition structure.
  - Do keep the caller action set small and readable.
  - Don’t redesign the whole environment architecture in this thread.
```

---

## Suggested Execution Pattern

- Treat each workstream as its own thread or sub-agent task.
- Carry over only:
  - the relevant brief above
  - any touched files
  - decisions already made in that workstream
- After each workstream lands:
  - update this file with the decision made
  - note any new constraints introduced for the remaining workstreams

## Recommended Sequencing

The implemented order ended up as:

1. Public vs private environment boundary
2. Environment action validation / state machine
3. Semantic event model
4. Scenario / task-family architecture

That sequencing worked well because each later step built on a cleaner contract.

---

## Synthesized Recommendations

The four independent architecture briefs converged on the same main idea: the current system-level split is good, but the internal contracts need to become more explicit before the next phase of policy/versioning work.

### 1. Public vs Private Boundary

This is the highest-priority structural fix.

- The current type boundary is unsafe because the caller-facing agent contract can see fields that are supposed to be hidden environment ground truth.
- The recommended split is:
  - `ScenarioSpec`: environment-private scenario ground truth
  - `CallerBrief`: caller-visible reset payload
  - `EpisodeObservation`: caller-visible per-step observation
  - optional `InternalEpisodeState`: environment-private wrapper combining `spec` and `observation`
- This should be fixed before broader refactors so future policy backends and version comparisons rely on a clean RL contract.

### 2. Environment Action Validation / State Machine

This should land immediately after the public/private split.

- `step()` should validate action legality against `callState` before dispatching.
- Invalid actions should generally become deterministic no-ops with an explicit penalty rather than exceptions, so trajectories remain analyzable.
- Keep the implementation small:
  - `validateAction(...)`
  - small action handlers
  - optional `invalidActionReason` surfaced in step results/logging

### 3. Semantic Event Model

This is the right next instrumentation cleanup after the environment contracts are stronger.

- Keep raw tool-level events for debugging if useful.
- Introduce semantic environment-only events for scoring and replay, such as:
  - `clarification_requested`
  - `account_resolved`
  - `follow_up_requested`
  - `field_returned`
  - semantic `lookup_failed`
- The voice agent should emit semantic turn outcomes.
- The environment should stop reverse-engineering high-level meaning from tool traces.

### 4. Scenario / Task-Family Architecture

This should come after the above three, not before.

- The current `Task` model is doing too much, but the cleanest refactor depends on the public/private split and semantic event design.
- The recommended structure is a lightweight scenario-module pattern under something like `src/env/scenarios/`.
- Each task family should eventually own:
  - hidden scenario spec construction
  - caller-brief rendering
  - voice-agent session config
  - fixed scenario helpers
  - later, semantic progress interpretation
- Keep this light. No heavy plugin system is needed.

---

## Recommended Implementation Roadmap

### Phase 1

Fix the environment contract.

- Introduce public/private type separation.
- Update the agent interface to accept only `CallerBrief` and `EpisodeObservation`.
- Make the environment own hidden `ScenarioSpec` internally.

### Phase 2

Make transitions principled.

- Add explicit legality checks for caller actions.
- Add invalid-action penalty handling and logging.
- Keep the state model readable and aligned with actual environment behavior.

### Phase 3

Improve observability semantics.

- Add semantic voice-agent events alongside raw tool trace.
- Switch reward/progress logic to semantic events once parity is confirmed.

### Phase 4

Refactor task-family structure.

- Introduce a small scenario registry/module layout.
- Move task-family-specific construction and configuration out of the generic environment.

---

## Agent Findings Snapshot

The parallel architecture reviews were completed by:

- `Hegel`: public vs private boundary
- `Epicurus`: scenario / task-family architecture
- `Feynman`: semantic event model
- `Aristotle`: environment action validation / state machine

The outputs from those reviews informed the synthesized recommendations above.
