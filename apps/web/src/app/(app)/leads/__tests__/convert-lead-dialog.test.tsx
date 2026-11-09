import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission, type Contact, type LeadWithRelations } from '@hilatech/contracts';
import { paginated, renderWithProviders, seedSession } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/leads/x',
  useSearchParams: () => new URLSearchParams(),
}));

const convert = vi.fn();
vi.mock('@/lib/api/leads', () => ({
  leadsApi: { convert: (...args: unknown[]) => convert(...args), list: vi.fn() },
}));
const listContacts = vi.fn();
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: { list: (...args: unknown[]) => listContacts(...args), tags: vi.fn() },
}));

import {
  ConvertLeadDialog,
  convertFormSchema,
  toConvertRequest,
} from '../[id]/convert-lead-dialog';

const LEAD: LeadWithRelations = {
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: '22222222-2222-4222-8222-222222222222',
  title: 'Acme website',
  status: 'proposal',
  source: 'website',
  value: 1200,
  currency: 'USD',
  contactId: null,
  assigneeId: null,
  description: null,
  tags: [],
  customFields: {},
  expectedCloseDate: null,
  convertedAt: null,
  lostReason: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  contact: null,
  assignee: null,
};

const CONTACT: Contact = {
  id: '44444444-4444-4444-8444-444444444444',
  organizationId: LEAD.organizationId,
  firstName: 'Dana',
  lastName: 'Cohen',
  email: 'dana@acme.test',
  phone: null,
  company: 'Acme',
  jobTitle: null,
  tags: [],
  notes: null,
  customFields: {},
  ownerId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('ConvertLeadDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listContacts.mockResolvedValue(paginated([CONTACT]));
    seedSession([Permission.LEADS_READ, Permission.LEADS_UPDATE, Permission.CONTACTS_READ]);
  });

  it('requires a first name when creating a contact and a selection when linking one', async () => {
    renderWithProviders(<ConvertLeadDialog open onOpenChange={() => {}} lead={LEAD} />);
    // A lead without a contact defaults to "create a new contact".
    expect(screen.getByRole('radio', { name: /Create a new contact/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Convert lead' }));
    expect(await screen.findByText('Enter a first name')).toBeInTheDocument();
    expect(convert).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: /Link an existing contact/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Convert lead' }));
    expect(await screen.findByText('Select a contact to link')).toBeInTheDocument();
    expect(convert).not.toHaveBeenCalled();
  });

  it('sends exactly one of contactId / contact plus the markWon flag', async () => {
    convert.mockResolvedValueOnce({
      lead: { ...LEAD, status: 'won', contactId: CONTACT.id },
      contact: CONTACT,
    });
    const onConverted = vi.fn();
    renderWithProviders(
      <ConvertLeadDialog open onOpenChange={() => {}} lead={LEAD} onConverted={onConverted} />,
    );
    await userEvent.type(screen.getByLabelText(/First name/), 'Dana');
    await userEvent.type(screen.getByLabelText(/^Email/), 'dana@acme.test');
    await userEvent.click(screen.getByRole('checkbox', { name: /Mark as won/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Convert lead' }));

    await waitFor(() => expect(convert).toHaveBeenCalledTimes(1));
    const [id, body] = convert.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(LEAD.id);
    expect(body).toEqual({
      contact: { firstName: 'Dana', email: 'dana@acme.test' },
      markWon: true,
    });
    expect('contactId' in body).toBe(false);
    await waitFor(() => expect(onConverted).toHaveBeenCalled());
  });

  it('links an existing contact chosen from the picker', async () => {
    convert.mockResolvedValueOnce({ lead: { ...LEAD, contactId: CONTACT.id }, contact: CONTACT });
    renderWithProviders(<ConvertLeadDialog open onOpenChange={() => {}} lead={LEAD} />);
    await userEvent.click(screen.getByRole('radio', { name: /Link an existing contact/ }));
    await userEvent.click(screen.getByRole('combobox', { name: /Contact/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Dana Cohen/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Convert lead' }));
    await waitFor(() => expect(convert).toHaveBeenCalledTimes(1));
    expect(convert.mock.calls[0]?.[1]).toEqual({ contactId: CONTACT.id, markWon: false });
  });
});

describe('convert form schema', () => {
  it('produces a payload the contract accepts with exactly one branch', () => {
    const existing = toConvertRequest(
      convertFormSchema.parse({
        mode: 'existing',
        contactId: CONTACT.id,
        contact: { firstName: 'ignored', lastName: '', email: '', phone: '', company: '' },
        markWon: false,
      }),
    );
    expect(existing).toEqual({ contactId: CONTACT.id, markWon: false });

    const created = toConvertRequest(
      convertFormSchema.parse({
        mode: 'new',
        contactId: CONTACT.id,
        contact: { firstName: 'Dana', lastName: '', email: '', phone: '', company: 'Acme' },
        markWon: true,
      }),
    );
    expect(created).toEqual({ contact: { firstName: 'Dana', company: 'Acme' }, markWon: true });
  });
});
