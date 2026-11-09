import { type WorkflowTemplate } from '@hilatech/contracts';

/** Placeholder id for resources the user must pick before activating a template (rejected on activation). */
export const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Ready-made workflows. Every template validates against `validateWorkflowDefinition`; those that need an
 * agent or user carry the placeholder id and list what to fill in under `requires`.
 */
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    key: 'notify-assignee-on-new-lead',
    name: 'Notify the assignee about a new lead',
    description: 'When a lead is created with an assignee, send them an in-app notification with a link.',
    category: 'notifications',
    requires: [],
    trigger: { type: 'event', event: 'lead.created' },
    steps: [
      {
        id: 'notify',
        type: 'send_notification',
        to: { kind: 'assignee' },
        title: 'New lead: {{ trigger.payload.title }}',
        body: 'Source: {{ trigger.payload.source }}, status: {{ trigger.payload.status }}',
        link: '/leads/{{ trigger.payload.leadId }}',
      },
    ],
  },
  {
    key: 'note-when-lead-won',
    name: 'Add a note when a lead is won',
    description: 'When a lead status changes to "won", record a note on the lead and tag it.',
    category: 'crm',
    requires: [],
    trigger: { type: 'event', event: 'lead.status_changed' },
    steps: [
      {
        id: 'is-won',
        type: 'condition',
        left: '{{ trigger.payload.status }}',
        operator: 'eq',
        right: 'won',
        then: ['note', 'tag'],
        else: [],
      },
      {
        id: 'note',
        type: 'create_lead_note',
        leadId: '{{ trigger.payload.leadId }}',
        body: 'Lead marked as won (was "{{ trigger.payload.previousStatus }}").',
      },
      {
        id: 'tag',
        type: 'update_lead',
        leadId: '{{ trigger.payload.leadId }}',
        addTags: ['won-automation'],
      },
    ],
  },
  {
    key: 'welcome-new-lead-with-n8n',
    name: 'Forward new leads to n8n',
    description: 'Send every new lead to an n8n workflow (requires a connected n8n integration).',
    category: 'integrations',
    requires: ['n8n integration'],
    trigger: { type: 'event', event: 'lead.created' },
    steps: [
      {
        id: 'to-n8n',
        type: 'n8n_trigger',
        webhook: 'new-lead',
        payload: { leadId: '{{ trigger.payload.leadId }}', title: '{{ trigger.payload.title }}' },
      },
    ],
  },
  {
    key: 'inbound-webhook-alert-admins',
    name: 'Alert admins from an inbound webhook',
    description: 'Bind an inbound webhook endpoint to this workflow and notify all admins with the payload message.',
    category: 'notifications',
    requires: ['inbound webhook endpoint'],
    trigger: { type: 'webhook' },
    steps: [
      {
        id: 'alert',
        type: 'send_notification',
        to: { kind: 'role', roleKey: 'admin' },
        title: 'Inbound webhook: {{ trigger.payload.title }}',
        body: '{{ trigger.payload.message }}',
      },
    ],
  },
  {
    key: 'weekday-agent-digest',
    name: 'Weekday morning agent digest',
    description: 'Every weekday at 08:00 (organization time zone) run an agent and notify the owner with its answer.',
    category: 'scheduling',
    requires: ['agentId', 'owner userId'],
    trigger: { type: 'schedule', cron: '0 8 * * 1-5' },
    steps: [
      {
        id: 'digest',
        type: 'agent_run',
        agentId: PLACEHOLDER_ID,
        input: 'Summarise yesterday\'s new leads and open conversations.',
        wait: true,
      },
      {
        id: 'tell',
        type: 'send_notification',
        to: { kind: 'user', userId: PLACEHOLDER_ID },
        title: 'Your morning digest',
        body: '{{ steps.digest.output.output }}',
      },
    ],
  },
  {
    key: 'agent-triage-customer-message',
    name: 'AI triage of customer messages',
    description: 'When a customer message arrives, let an agent draft a reply suggestion and notify the assignee.',
    category: 'ai',
    requires: ['agentId'],
    trigger: { type: 'event', event: 'conversation.message_received' },
    steps: [
      {
        id: 'triage',
        type: 'agent_run',
        agentId: PLACEHOLDER_ID,
        input: 'Customer wrote: {{ trigger.payload.preview }}. Suggest a short, helpful reply.',
        wait: true,
      },
      {
        id: 'tell',
        type: 'send_notification',
        to: { kind: 'assignee' },
        title: 'Suggested reply ready',
        body: '{{ steps.triage.output.output }}',
        link: '/conversations/{{ trigger.payload.conversationId }}',
      },
    ],
  },
];
