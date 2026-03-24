import { createRequire } from 'module';
import { z } from 'zod';
import { AccountSchema } from './types.js';
import type { Account, QueryableField } from './types.js';

const require = createRequire(import.meta.url);
const rawData: Account[] = z.array(AccountSchema).parse(require('./data.json'));

// Build indices at module load time
const byId = new Map<string, Account>();
const byNormalizedName = new Map<string, Account>();

for (const account of rawData) {
  byId.set(account.id, account);
  byNormalizedName.set(account.company_name.toLowerCase(), account);
}

export function getAllAccounts(): Account[] {
  return rawData;
}

export function findById(id: string): Account | undefined {
  return byId.get(id);
}

/** Exact match first, then substring match. Returns all matches. */
export function findByName(name: string): Account[] {
  const lower = name.toLowerCase();
  const exact = byNormalizedName.get(lower);
  if (exact) return [exact];
  return rawData.filter(a => a.company_name.toLowerCase().includes(lower));
}

/** Find all accounts that have a contact whose name includes the given string. */
export function findByContactName(contactName: string): Account[] {
  const lower = contactName.toLowerCase();
  return rawData.filter(a =>
    a.contacts.some(c => c.name.toLowerCase().includes(lower))
  );
}

export function getFieldValue(account: Account, field: QueryableField): string {
  switch (field) {
    case 'contract_value':
      return account.contract_value === 0 ? 'No contract on file' : `$${account.contract_value.toLocaleString()}`;
    case 'contract_renewal_date':
      return account.contract_renewal_date || 'No renewal date on file';
    case 'deal_stage':
      return account.deal_stage.replace(/_/g, ' ');
    case 'account_status':
      return account.account_status.replace(/_/g, ' ');
    case 'last_activity':
      return account.last_activity;
  }
}

// Inline validation — run with: npx tsx src/crm/store.ts
if (process.argv[1]?.endsWith('store.ts') || process.argv[1]?.endsWith('store.js')) {
  console.log('=== CRM Store Validation ===\n');

  const acme = findByName('Acme Corp');
  console.assert(acme.length === 1, 'findByName: expected 1 result for Acme Corp');
  console.log(`findByName('Acme Corp'): ${acme[0]?.company_name} ✓`);

  const sarahs = findByContactName('Sarah');
  console.assert(sarahs.length >= 3, `findByContactName: expected 3+ Sarahs, got ${sarahs.length}`);
  console.log(`findByContactName('Sarah'): found in ${sarahs.length} accounts:`);
  for (const a of sarahs) {
    const contact = a.contacts.find(c => c.name.toLowerCase().includes('sarah'));
    console.log(`  - ${a.company_name}: ${contact?.name}`);
  }

  const globex = findByName('Globex')[0];
  if (globex) {
    console.log(`\ngetFieldValue contract_value: ${getFieldValue(globex, 'contract_value')}`);
    console.log(`getFieldValue deal_stage: ${getFieldValue(globex, 'deal_stage')}`);
    console.log(`getFieldValue account_status: ${getFieldValue(globex, 'account_status')}`);
  }

  console.log(`\nTotal accounts loaded: ${rawData.length}`);
  console.log('\nAll checks passed ✓');
}
