import { z } from 'zod';

export const ContactSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  role: z.string().optional(),
});

export const AccountSchema = z.object({
  id: z.string(),
  company_name: z.string(),
  contacts: z.array(ContactSchema),
  // 'at_risk' is a valid real-world deal stage distinct from account_status
  deal_stage: z.enum(['prospect', 'negotiation', 'closed_won', 'closed_lost', 'renewal', 'at_risk']),
  last_activity: z.string(),
  contract_value: z.number(),
  contract_renewal_date: z.string(),
  account_status: z.enum(['active', 'churned', 'at_risk', 'new']),
});

export type Contact = z.infer<typeof ContactSchema>;
export type Account = z.infer<typeof AccountSchema>;

export type QueryableField =
  | 'contract_value'
  | 'contract_renewal_date'
  | 'deal_stage'
  | 'account_status'
  | 'last_activity';
