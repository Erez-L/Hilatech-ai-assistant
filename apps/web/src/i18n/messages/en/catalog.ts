/** Display texts for items the API describes in English only: agent tools and workflow templates. */
export const catalog = {
  'catalog.tool.crm.search_contacts.name': 'Search contacts',
  'catalog.tool.crm.search_contacts.description':
    'Find contacts of the organization by name, email, phone or company.',
  'catalog.tool.crm.get_contact.name': 'Get contact',
  'catalog.tool.crm.get_contact.description':
    'Load one contact with its recent leads and conversations.',
  'catalog.tool.crm.create_contact.name': 'Create contact',
  'catalog.tool.crm.create_contact.description':
    'Create a new contact in the organization address book.',
  'catalog.tool.crm.search_leads.name': 'Search leads',
  'catalog.tool.crm.search_leads.description':
    'List leads, optionally filtered by text, status or assignee. Returns the most recently updated first.',
  'catalog.tool.crm.get_lead.name': 'Get lead',
  'catalog.tool.crm.get_lead.description':
    'Load one lead with its contact, latest notes and recent activity.',
  'catalog.tool.crm.create_lead.name': 'Create lead',
  'catalog.tool.crm.create_lead.description':
    'Create a new sales lead, optionally linked to an existing contact.',
  'catalog.tool.crm.update_lead_status.name': 'Update lead status',
  'catalog.tool.crm.update_lead_status.description':
    'Move a lead to another pipeline status (new, contacted, qualified, proposal, won, lost).',
  'catalog.tool.crm.add_lead_note.name': 'Add lead note',
  'catalog.tool.crm.add_lead_note.description':
    'Append a note to a lead (e.g. a summary of a call or a next step).',
  'catalog.tool.crm.list_conversations.name': 'List conversations',
  'catalog.tool.crm.list_conversations.description':
    'List customer conversations, optionally filtered by status, contact or lead.',
  'catalog.tool.crm.get_conversation_messages.name': 'Get conversation messages',
  'catalog.tool.crm.get_conversation_messages.description':
    'Read the latest messages of a customer conversation (newest last).',
  'catalog.tool.agents.delegate.name': 'Delegate to agent',
  'catalog.tool.agents.delegate.description':
    'Hands a well-defined sub-task to another agent of the organization and waits for its result. Works only when the agent is allowed to delegate.',
  'catalog.tool.agents.delegate_parallel.name': 'Delegate in parallel',
  'catalog.tool.agents.delegate_parallel.description':
    'Runs several independent sub-tasks on other agents at the same time and combines their results. Works only when the agent is allowed to delegate.',
  'catalog.tool.time.now.name': 'Current time',
  'catalog.tool.time.now.description': 'Returns the current date and time and the day of week.',
  'catalog.tool.knowledge.search.name': 'Search knowledge base',
  'catalog.tool.knowledge.search.description':
    "Searches the organization's uploaded documents by meaning and returns the most relevant passages with their sources.",
  'catalog.tool.tasks.list.name': 'List tasks',
  'catalog.tool.tasks.list.description':
    'List tasks of the organization, optionally filtered by status, assignee, related record or overdue.',
  'catalog.tool.tasks.create.name': 'Create task',
  'catalog.tool.tasks.create.description':
    'Create a task, optionally linked to a lead, contact, deal or conversation, with a due date and reminder.',
  'catalog.tool.deals.list.name': 'List deals',
  'catalog.tool.deals.list.description':
    'List deals with their pipeline stage, optionally filtered by status, stage, owner, contact or text.',
  'catalog.tool.deals.create.name': 'Create deal',
  'catalog.tool.deals.create.description':
    'Create a deal in a pipeline (the default pipeline and its first open stage unless given).',
  'catalog.tool.deals.move.name': 'Move deal',
  'catalog.tool.deals.move.description':
    'Move a deal to another stage of its pipeline. Moving to a won or lost stage closes the deal.',
  'catalog.template.notify-assignee-on-new-lead.name': 'Notify the assignee about a new lead',
  'catalog.template.notify-assignee-on-new-lead.description':
    'When a lead is created with an assignee, send them an in-app notification with a link.',
  'catalog.template.note-when-lead-won.name': 'Add a note when a lead is won',
  'catalog.template.note-when-lead-won.description':
    'When a lead status changes to "won", record a note on the lead and tag it.',
  'catalog.template.welcome-new-lead-with-n8n.name': 'Forward new leads to n8n',
  'catalog.template.welcome-new-lead-with-n8n.description':
    'Send every new lead to an n8n workflow (requires a connected n8n integration).',
  'catalog.template.inbound-webhook-alert-admins.name': 'Alert admins from an inbound webhook',
  'catalog.template.inbound-webhook-alert-admins.description':
    'Bind an inbound webhook endpoint to this workflow and notify all admins with the payload message.',
  'catalog.template.weekday-agent-digest.name': 'Weekday morning agent digest',
  'catalog.template.weekday-agent-digest.description':
    'Every weekday at 08:00 (organization time zone) run an agent and notify the owner with its answer.',
  'catalog.template.agent-triage-customer-message.name': 'AI triage of customer messages',
  'catalog.template.agent-triage-customer-message.description':
    'When a customer message arrives, let an agent draft a reply suggestion and notify the assignee.',
  'catalog.requirement.agent': 'an agent',
  'catalog.requirement.owner': 'an owner',
  'catalog.requirement.n8n': 'a connected n8n integration',
  'catalog.requirement.inboundWebhook': 'an inbound webhook',
  'catalog.integration.rest.name': 'REST / Webhook',
  'catalog.integration.rest.description':
    'Call any HTTPS API or webhook from your automations, with optional authentication.',
  'catalog.integration.n8n.name': 'n8n',
  'catalog.integration.n8n.description':
    'Hand events to n8n workflows. Optional: everything else works without it.',
  'catalog.integration.email.name': 'Email',
  'catalog.integration.email.description': 'Send email to customers from automations.',
  'catalog.integration.whatsapp.name': 'WhatsApp Business',
  'catalog.integration.whatsapp.description': 'Send and receive WhatsApp messages with customers.',
  'catalog.integration.crm.name': 'External CRM',
  'catalog.integration.crm.description':
    'Sync contacts and deals with HubSpot, Pipedrive or Salesforce.',
} as const;
