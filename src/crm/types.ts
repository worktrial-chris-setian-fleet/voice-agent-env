import { z } from 'zod';

/** CRM contact schema used for validation and type inference. */
export const ContactSchema = z.object({
  /** Human-readable contact name. */
  name: z.string(),
  /** Primary phone number associated with the contact. */
  phone: z.string(),
  /** Primary email address associated with the contact. */
  email: z.string(),
  /** Optional job title or role hint used in some disambiguation scenarios. */
  role: z.string().optional(),
});

/** CRM account schema representing one simulated customer record. */
export const AccountSchema = z.object({
  /** Stable internal account identifier. */
  id: z.string(),
  /** Canonical company name used for lookup and reporting. */
  company_name: z.string(),
  /** Contacts attached to the account. */
  contacts: z.array(ContactSchema),
  // 'at_risk' is a valid real-world deal stage distinct from account_status
  /** Pipeline/deal progression stage for the account. */
  deal_stage: z.enum(['prospect', 'negotiation', 'closed_won', 'closed_lost', 'renewal', 'at_risk']),
  /** Most recent CRM activity date stored as a string. */
  last_activity: z.string(),
  /** Contract value stored as a number for exact formatting/control in the store layer. */
  contract_value: z.number(),
  /** Contract renewal date stored as a string. */
  contract_renewal_date: z.string(),
  /** Customer lifecycle status, distinct from deal stage. */
  account_status: z.enum(['active', 'churned', 'at_risk', 'new']),
});

/** Inferred TypeScript type for one CRM contact record. */
export type Contact = z.infer<typeof ContactSchema>;
/** Inferred TypeScript type for one CRM account record. */
export type Account = z.infer<typeof AccountSchema>;

/** CRM fields that the caller may be tasked with retrieving. */
export type QueryableField =
  | 'contract_value'
  | 'contract_renewal_date'
  | 'deal_stage'
  | 'account_status'
  | 'last_activity';
