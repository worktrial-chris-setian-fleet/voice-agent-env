# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Voice Agent RL Environment**. The caller agent is the RL subject: it makes outbound "calls", interacts through a dialogue layer, and is rewarded for retrieving the correct CRM information efficiently. The caller does not access CRM data directly.

## Architecture

The system has four main components:

1. **CRM Data Store** — A static dataset of ~20–50 accounts (JSON file or in-memory). Fields: company name, primary contact, deal stage, last activity, contract value, contract renewal date, account status.

2. **MCP Server** — The voice agent's internal interface to the CRM. The caller agent must not access CRM data directly. Tool definitions here are critical because they shape how the environment-side voice agent retrieves and explains account data.

3. **Voice/Dialogue Layer** — Simulates the call interface. Agent actions are natural language utterances. This layer should model realistic failure modes: answering machine, wrong number, ambiguous query (e.g., multiple contacts named "Sarah"), missing records, wrong field retrieved.

4. **RL Environment + Agent Loop** — Wraps the above into episodes. Each episode: caller receives a task → takes call actions (`initiate_call`, `speak`, `submit_answer`, `end_call`) → receives reward. Reward signal is based on correctness, efficiency, and disambiguation behavior.

## Task Types

The repo currently supports three retrieval paths:
- **Simple lookup**: "Find the contract value for Acme Corp" — direct single-step retrieval.
- **Disambiguation**: Multi-step retrieval requiring clarification (e.g., multiple records match, ambiguous input).
- **Resolve then retrieve**: Identify the correct account from partial identity plus clues, then ask a follow-up to get the final field.

## Key Design Decisions to Make

- Language/framework choice (Python is natural for RL; Node.js for MCP servers)
- Whether MCP server is in-process or runs as a subprocess
- How the dialogue layer is modeled (state machine, LLM-as-interlocutor, scripted responses)
- State representation for the agent (conversation history, tool call results, task description)
- Action space design (free-form utterance vs. structured action types)
- Reward shaping (sparse vs. shaped; efficiency penalty for extra turns)

## Environment Variables

API keys are stored in `.env` (not committed). Required keys:
- `ANTHROPIC_API_KEY`

## Deliverables

- Working environment + agent loop
- Written analysis ([`docs/design-notes.md`](docs/design-notes.md)) covering reward landscape, environment design improvements, and what it would take to integrate a real voice API (STT/TTS)
