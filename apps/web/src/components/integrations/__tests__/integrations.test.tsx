import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, seedSession } from '@/test/render';
import { mockApi } from '@/test/fetch';
import { ConnectDialog } from '../connect-dialog';
import { IntegrationsView } from '@/app/(app)/integrations/integrations-view';

afterEach(() => vi.unstubAllGlobals());

const CATALOG = [
  {
    kind: 'rest',
    name: 'REST / Webhook',
    description: 'd',
    providers: ['generic'],
    requiredSecrets: [],
    liveSupport: 'full',
  },
  {
    kind: 'email',
    name: 'Email (SMTP)',
    description: 'd',
    providers: ['smtp'],
    requiredSecrets: [],
    liveSupport: 'planned',
  },
];

describe('IntegrationsView', () => {
  beforeEach(() => seedSession(['integrations:read', 'integrations:manage']));

  it('offers Connect only for live kinds and labels planned kinds honestly', async () => {
    mockApi({
      'GET /integrations/catalog': () => CATALOG,
      'GET /integrations/status': () => [],
      'GET /integrations': () => [
        {
          id: 'i1',
          kind: 'rest',
          name: 'Billing API',
          config: { baseUrl: 'https://x.test' },
          hasSecrets: true,
          secretKeys: ['accessToken'],
          isEnabled: true,
          status: 'connected',
          lastCheckedAt: null,
          lastError: null,
        },
      ],
    });
    renderWithProviders(<IntegrationsView />);
    expect(
      await screen.findByRole('button', { name: 'Connect REST / Webhook' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Email/ })).toBeNull();
    expect(screen.getByText('Requires a provider')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    // Credentials: names only, never values.
    expect(await screen.findByText(/Credentials stored: Access token/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test connection Billing API' })).toBeInTheDocument();
  });

  it('hides management actions without integrations:manage', async () => {
    seedSession(['integrations:read']);
    mockApi({
      'GET /integrations/catalog': () => CATALOG,
      'GET /integrations/status': () => [],
      'GET /integrations': () => [],
    });
    renderWithProviders(<IntegrationsView />);
    await screen.findByText('REST / Webhook');
    expect(screen.queryByRole('button', { name: /Connect REST/ })).toBeNull();
  });
});

describe('ConnectDialog', () => {
  beforeEach(() => seedSession(['integrations:read', 'integrations:manage']));

  it('sends credentials write-only and uses password inputs', async () => {
    const { calls } = mockApi({
      'POST /integrations': () => ({ id: 'i1', name: 'API', status: 'connected' }),
    });
    const onClose = vi.fn();
    renderWithProviders(<ConnectDialog kind="rest" onClose={onClose} />);
    await userEvent.clear(screen.getByLabelText(/^Name/));
    await userEvent.type(screen.getByLabelText(/^Name/), 'API');
    await userEvent.type(screen.getByLabelText(/^Base URL/), 'https://api.example.com');
    await userEvent.selectOptions(screen.getByLabelText('Authentication'), 'bearer');
    const token = screen.getByLabelText('Bearer token');
    expect(token).toHaveAttribute('type', 'password');
    await userEvent.type(token, 's3cret-token');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]!.body).toMatchObject({
      name: 'API',
      config: { kind: 'rest', baseUrl: 'https://api.example.com', authType: 'bearer' },
      secrets: { accessToken: 's3cret-token' },
    });
  });

  it('validates the base URL', async () => {
    const { calls } = mockApi({});
    renderWithProviders(<ConnectDialog kind="n8n" onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^Base URL/), 'not a url');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('never prefills stored secrets when editing', () => {
    renderWithProviders(
      <ConnectDialog
        kind="rest"
        onClose={() => {}}
        integration={{
          id: 'i1',
          organizationId: 'o',
          kind: 'rest',
          name: 'Billing',
          hasSecrets: true,
          secretKeys: ['accessToken'],
          isEnabled: true,
          status: 'connected',
          lastCheckedAt: null,
          lastError: null,
          createdAt: '',
          updatedAt: '',
          config: { kind: 'rest', baseUrl: 'https://x.test', authType: 'bearer', headers: {} },
        }}
      />,
    );
    expect(screen.getByLabelText('Bearer token')).toHaveValue('');
    expect(screen.getByText(/A value is stored/)).toBeInTheDocument();
  });
});
