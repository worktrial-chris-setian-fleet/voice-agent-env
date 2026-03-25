# voice-agent-env
Work Trial Project: Voice Agent RL Environment

# Context
We're exploring a system where a model learns to navigate voice-based interactions — specifically, making outbound "calls" to a voice agent to retrieve information from a CRM. Think of it as a simulated environment where the model dials into a system, speaks (or receives speech), and learns to extract the right data through trial and error.

The model lives outside the environment in this scenario, and there is also a voice agent inside the environment.

# The Problem
Build an environment where an external agent (in principle could also be a human) can initiate a voice-based call into the environment (webRTC or phone are both OK) and attempt to retrieve a specific piece of information from a prepopulated CRM dataset (e.g., a contact's contract renewal date, account status, or last interaction).

# The environment should expose:
- A simulated CRM — a static dataset of ~20–50 accounts with fields like company name, primary contact, deal stage, last activity, and contract value. This can be a JSON file or in-memory store.
- An MCP server — the agent's interface to the CRM. The agent interacts with the CRM exclusively through MCP tool calls, not direct data access.
- A voice/dialogue layer — the environment’s interface takes the form of natural language (e.g., asking for a record, clarifying a name, confirming details). How you model this layer is up to you.
- A reward signal — the agent should receive feedback based on whether it successfully retrieved the correct information, and how efficiently it did so.
  - Not sure what this should look like, propose something!


## Part 1: The Environment (Core)
Build the simulated environment end-to-end:
- The CRM data, MCP server, and dialogue layer should be functional enough to run a full episode: the model receives a task (e.g., "find the contract value for Acme Corp"), takes actions through the voice/dialogue interface, calls MCP tools, and receives a reward.
- Implement at least two types of tasks with meaningfully different retrieval paths (e.g., a simple lookup vs. a query that requires disambiguation — "there are three contacts named Sarah, which one?").
- The environment should handle realistic failure modes — the model asks for a record that doesn't exist, provides an ambiguous query, or retrieves the wrong field. These should be reflected in the state and reward.

## Part 2: The Agent Loop
Wire up a basic training or evaluation loop:
- A model that can run multiple episodes against the environment, with observable behavior across runs.
- The formulation doesn't need to be sophisticated, but it should be a real loop — not just a single hardcoded trajectory. We should be able to see the model’s behavior, even if learning is minimal in the time available.
- Include a simple way to observe what's happening (logs, a basic dashboard, printed episode summaries — your call).

## Part 3: Analysis & Extensions
Write up a short document (can be in the README or separate) covering:
- What does the reward landscape look like? Where would an agent get stuck, and why?
- If you had another week, what would you change about the environment design? The MCP interface? The state/action representation?

# What We're Looking For
- This is a design and engineering exercise, not a production deliverable. We care about:
How you decompose the problem. What abstractions do you choose? Where do you draw boundaries between the environment, the agent, and the tooling layer?
- What you choose to build vs. stub. Not everything needs to work end-to-end. We want to see judgment about where to invest depth and where a clear interface is enough.
- How you think about the RL loop. State representation, action space, reward shaping — even if the training itself is simple, we want to see the thinking.
- Quality of the MCP integration. The tool definitions, how the agent discovers and uses them, and how you handle the boundary between structured tool calls and unstructured dialogue.
- Technical communication. The written analysis matters. We want to see how you reason about systems you've built and their limitations.

# Deliverables
- A working environment + agent loop with a README that explains your approach, the tradeoffs you made, and what you'd do with more time.
- The written analysis from Part 3.
Code in a GitHub repo. Use whatever language and frameworks feel right.

