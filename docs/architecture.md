# Architecture 

## Personas

There are three distinct actors in this simulation.

**The external caller ("agent")** is an automated account manager working on behalf of a vendor — a company that sells to the accounts in the CRM. Its job is to call a CRM helpline and retrieve specific account details: contract terms, deal status, renewal windows, account health. Think of it as an AI stand-in for a human account executive or customer success rep. This is the RL subject: the entity being trained, evaluated, and whose behavior the reward signal shapes. It has no direct access to the CRM — it can only extract information through conversation.

**The voice agent** is an AI representative that answers the helpline. It lives inside the RL environment, not outside it. When the caller speaks, the voice agent receives the utterance, uses its internal CRM tools to look up the relevant data, and responds in natural language. The voice agent is not being trained — it is a fixed component of the environment, analogous to the physics engine in a game simulation. Its job is to be a realistic, capable gatekeeper that the external caller must navigate effectively.

**The CRM** is the data layer. It stores 30 accounts with fields like contract value, deal stage, and renewal date. The voice agent queries it via MCP tools (`lookup_account`, `get_account_field`, `search_contacts`). The CRM is also the source of ground truth for the reward signal: the environment evaluates whether the caller's submitted answer matches the CRM record.

The business scenario: a vendor's CRM helpline has account data, but the external caller doesn't have direct system access. It must call in, identify the right account, and extract the specific field it was sent to retrieve. The voice agent is the gatekeeper — it has the data, but the caller has to ask the right questions to get it.

This framing gives the failure modes business meaning:
- **Answering machine** — the helpline is unavailable; common in real outbound scenarios
- **Wrong number** — the account record has a stale or incorrect contact; a real data quality problem
- **Disambiguation** — multiple accounts share a contact name like "Sarah"; the caller must narrow down to the right one
- **Turn penalty** — the cost of an inefficient conversation; asking five questions to get one answer has real overhead

## Key Design Notes

- **Two-LLM architecture** — there are two separate Claude instances per episode. The *external caller* (`LLMAgent`) uses hardcoded action tools (`initiate_call`, `speak`, `submit_answer`, `end_call`) and has no access to the CRM. The *voice agent* (`VoiceAgent`) lives inside the environment and runs an internal agentic tool loop per utterance, calling CRM MCP tools to look up data before responding.
- **MCP is internal plumbing** — the caller never touches MCP. MCP is exclusively how the voice agent queries the CRM store. The three CRM tools (`lookup_account`, `get_account_field`, `search_contacts`) are only available to the voice agent. See `docs/design-notes.md` for the full discussion.
- **CallerAction as the RL boundary** — `VoiceAgentEnv.step()` accepts a `CallerAction` union type (`initiate_call | speak | submit_answer | end_call`). This is the interface being trained: the external caller learns to extract information efficiently through this action space.
- **Call outcome simulation** — probabilistic routing (80% ANSWERED, 10% ANSWERING_MACHINE, 5% WRONG_NUMBER, 5% NO_ANSWER) is handled by the environment, not the voice agent. The voice agent only activates after a successful `ANSWERED` outcome.
- **InMemoryTransport as the seam** — the MCP client and server run in the same process connected via a linked transport pair. Swapping to stdio or SSE transport is the only change needed to run the MCP server as a subprocess or remote service.
- **Shared store** — the dotted line from `store.ts` to `VoiceAgentEnv` shows CRM data feeding both the voice agent (via MCP tools) and the reward evaluator. Both paths read from the same source. See `docs/design-notes.md` for the full discussion.
