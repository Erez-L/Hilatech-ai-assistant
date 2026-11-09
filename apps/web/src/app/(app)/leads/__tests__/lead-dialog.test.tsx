import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission, type LeadWithRelations } from '@hilatech/contracts';
import { ApiError } from '@/lib/api/client';
import { paginated, renderWithProviders, seedSession } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(),
}));

const create = vi.fn();
vi.mock('@/lib/api/leads', () => ({
  leadsApi: { create: (...args: unknown[]) => create(...args), list: vi.fn() },
}));
const listContacts = vi.fn();
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: { list: (...args: unknown[]) => listContacts(...args), tags: vi.fn() },
}));
vi.mock('@/lib/api/members', () => ({
  membersApi: { list: vi.fn().mockResolvedValue({ data: [], meta: {} }) },
}));

import { LeadDialog } from '../lead-dialog';
import { leadFormSchema, toCreateLeadRequest } from '../lead-form';

const LEAD: LeadWithRelations = {
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: '22222222-2222-4222-8222-222222222222',
  title: 'Acme website',
  status: 'new',
  source: 'other',
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

describe('LeadDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listContacts.mockResolvedValue(paginated([]));
    seedSession([Permission.LEADS_READ, Permission.LEADS_CREATE, Permission.LEADS_UPDATE]);
  });

  it('validates with the contract rules before calling the API', async () => {
    renderWithProviders(<LeadDialog open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create lead' }));
    expect(await screen.findByText('Enter a title')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/^Title/), 'Acme website');
    await userEvent.clear(screen.getByLabelText(/^Value/));
    await userEvent.type(screen.getByLabelText(/^Value/), '-5');
    await userEvent.click(screen.getByRole('button', { name: 'Create lead' }));
    expect(await screen.findByText('Value cannot be negative')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('submits a contract-shaped payload and reports the created lead', async () => {
    create.mockResolvedValueOnce(LEAD);
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(<LeadDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText(/^Title/), 'Acme website');
    await userEvent.type(screen.getByLabelText(/^Value/), '1200');
    await userEvent.selectOptions(screen.getByLabelText(/^Source/), 'referral');
    await userEvent.type(screen.getByLabelText(/^Tags/), 'vip{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Create lead' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      title: 'Acme website',
      status: 'new',
      source: 'referral',
      value: 1200,
      currency: 'USD',
      tags: ['vip'],
      customFields: {},
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(LEAD));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('maps server validation errors onto fields', async () => {
    create.mockRejectedValueOnce(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        details: [{ path: ['contactId'], message: 'Contact does not exist' }],
      }),
    );
    renderWithProviders(<LeadDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^Title/), 'Acme website');
    await userEvent.click(screen.getByRole('button', { name: 'Create lead' }));
    expect(await screen.findByText('Contact does not exist')).toBeInTheDocument();
  });
});

describe('lead form schema', () => {
  it('maps browser inputs to the create contract', () => {
    const parsed = leadFormSchema.parse({
      title: '  Big deal ',
      status: 'qualified',
      source: 'website',
      value: '99.5',
      currency: 'eur',
      contactId: '',
      assigneeId: '',
      description: '',
      tags: ['a'],
      expectedCloseDate: '2026-12-01',
    });
    const body = toCreateLeadRequest(parsed);
    expect(body).toMatchObject({
      title: 'Big deal',
      status: 'qualified',
      source: 'website',
      value: 99.5,
      currency: 'EUR',
      tags: ['a'],
    });
    expect(body.contactId).toBeUndefined();
    expect(body.description).toBeUndefined();
    expect(body.expectedCloseDate).toMatch(/^2026-12-01T/);
  });
});
