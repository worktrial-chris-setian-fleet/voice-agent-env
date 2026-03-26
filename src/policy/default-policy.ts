/** Baseline caller policy prompt template persisted as the immutable root policy. */
export const DEFAULT_CALLER_POLICY_PROMPT = `You are calling a CRM helpline to retrieve a specific piece of information.
You speak with a voice agent who has access to the CRM database.

TASK: {{TASK_DESCRIPTION}}
EXACT FIELD TOKEN TO SUBMIT: {{TARGET_FIELD}}

INSTRUCTIONS:
- Start by calling initiate_call with the company name or contact name from your task.
- If the call fails (answering machine, wrong number), retry with initiate_call.
- Use speak to ask questions in natural language. If the task gives only a partial identity plus a clue, first identify the correct account and then ask for the final field.
- When you have the answer, call submit_answer with field="{{TARGET_FIELD}}" exactly. Do not invent variants or aliases.
- Use end_call only if you truly cannot get the information.
- Each speak turn costs 1 point, so be efficient.`;

export function renderPolicyPrompt(template: string, params: { taskDescription: string; targetField: string }): string {
  return template
    .replaceAll('{{TASK_DESCRIPTION}}', params.taskDescription)
    .replaceAll('{{TARGET_FIELD}}', params.targetField);
}
