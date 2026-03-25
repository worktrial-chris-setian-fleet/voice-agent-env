# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is a **Voice Agent RL Environment** — a work trial project. The goal is to build a simulated environment where an RL agent makes outbound "calls" to a CRM via MCP tool calls, interacts through a dialogue layer, and receives a reward based on retrieval success.

## Architecture

The system has four main components:

1. **CRM Data Store** — A static dataset of ~20–50 accounts (JSON file or in-memory). Fields: company name, primary contact, deal stage, last activity, contract value, contract renewal date, account status.

2. **MCP Server** — The agent's exclusive interface to the CRM. The agent must not access CRM data directly — only through MCP tool calls. Tool definitions here are critical: how the agent discovers and uses them defines the interaction quality.

3. **Voice/Dialogue Layer** — Simulates the call interface. Agent actions are natural language utterances. This layer should model realistic failure modes: answering machine, wrong number, ambiguous query (e.g., multiple contacts named "Sarah"), missing records, wrong field retrieved.

4. **RL Environment + Agent Loop** — Wraps the above into episodes. Each episode: agent receives a task → takes actions via dialogue → calls MCP tools → receives reward. Reward signal based on correctness and efficiency (penalize unnecessary turns/calls).

## Task Types

Two meaningfully different retrieval paths are required:
- **Simple lookup**: "Find the contract value for Acme Corp" — direct single-step retrieval.
- **Disambiguation**: Multi-step retrieval requiring clarification (e.g., multiple records match, ambiguous input).

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
- `OPENAI_API_KEY`

## Deliverables

- Working environment + agent loop
- Written analysis (`Design-Notes.md`) covering: reward landscape, environment design improvements, what it would take to integrate a real voice API (STT/TTS)
