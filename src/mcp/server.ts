import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { findByName, findByContactName, findById, getFieldValue } from '../crm/store.js';
import type { QueryableField } from '../crm/types.js';

export type McpPair = {
  mcpServer: McpServer;
  client: Client;
};

const VALID_FIELDS = ['contract_value', 'contract_renewal_date', 'deal_stage', 'account_status', 'last_activity'];

export async function createCrmMcpPair(): Promise<McpPair> {
  const mcpServer = new McpServer({
    name: 'crm-mcp-server',
    version: '1.0.0',
  });

  // lookup_account: search by company name or contact name
  mcpServer.tool(
    'lookup_account',
    'Find CRM accounts by company name or contact name. Returns a list of matching accounts with their IDs.',
    { name: z.string().describe('Company or contact name to search for') },
    async ({ name }) => {
      const byCompany = findByName(name);
      const byContact = findByContactName(name);
      const seen = new Set<string>();
      const matches = [...byCompany, ...byContact].filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      });
      const results = matches.map(a => ({
        id: a.id,
        company_name: a.company_name,
        contact_names: a.contacts.map(c => c.name),
      }));
      const text = results.length === 0
        ? `No accounts found matching "${name}".`
        : JSON.stringify(results);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  // get_account_field: retrieve a specific field value for a known account
  mcpServer.tool(
    'get_account_field',
    `Get a specific field value for a CRM account by its ID. Valid fields: ${VALID_FIELDS.join(', ')}.`,
    {
      account_id: z.string().describe('The account ID returned by lookup_account'),
      field: z.string().describe(`Field to retrieve: ${VALID_FIELDS.join(', ')}`),
    },
    async ({ account_id, field }) => {
      const account = findById(account_id);
      if (!account) {
        return { content: [{ type: 'text' as const, text: `No account found with ID: ${account_id}` }] };
      }
      if (!VALID_FIELDS.includes(field)) {
        return { content: [{ type: 'text' as const, text: `Invalid field "${field}". Valid fields: ${VALID_FIELDS.join(', ')}` }] };
      }
      const value = getFieldValue(account, field as QueryableField);
      const result = { company_name: account.company_name, field, value };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  // search_contacts: search specifically by contact name (useful for disambiguation)
  mcpServer.tool(
    'search_contacts',
    'Search for CRM accounts by contact/representative name. Returns all accounts with a matching contact.',
    { name: z.string().describe('Contact or representative name to search for') },
    async ({ name }) => {
      const accounts = findByContactName(name);
      const results = accounts.flatMap(a =>
        a.contacts
          .filter(c => c.name.toLowerCase().includes(name.toLowerCase()))
          .map(c => ({ contact_name: c.name, account_id: a.id, company_name: a.company_name }))
      );
      const text = results.length === 0
        ? `No contacts found matching "${name}".`
        : JSON.stringify(results);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({
    name: 'crm-mcp-client',
    version: '1.0.0',
  });

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  return { mcpServer, client };
}
