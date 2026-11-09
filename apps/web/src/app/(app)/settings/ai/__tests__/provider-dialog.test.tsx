import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderConfig } from '@hilatech/contracts';
import { renderWithProviders, seedSession } from '@/test/render';
import { mockApi } from '@/test/fetch';
import { ProviderDialog, buildProviderRequest, providerFormSchema } from '../provider-dialog';

const PROVIDER: AiProviderConfig = {
  id: '99999999-9999-4999-8999-999999999999',
  organizationId: '22222222-2222-4222-8222-222222222222',
  provider: 'anthropic',
  name: 'Production',
  keyLast4: '1234',
  hasApiKey: true,
  baseUrl: null,
  defaultModel: 'claude-sonnet',
  embeddingModel: null,
  isDefault: true,
  isEnabled: true,
  lastHealthStatus: 'unknown',
  lastHealthCheckAt: null,
  lastHealthError: null,
  createdAt: '2026-11-09T10:00:00.000Z',
  updatedAt: '2026-11-09T10:00:00.000Z',
};

const MODELS = [
  {
    id: 'claude-sonnet',
    provider: 'anthropic',
    displayName: 'Claude Sonnet',
    contextWindow: null,
    maxOutputTokens: null,
    supportsTools: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsEmbeddings: false,
  },
];

describe('buildProviderRequest', () => {
  const base = providerFormSchema.parse({
    provider: 'anthropic',
    name: 'P',
    apiKey: '',
    baseUrl: '',
    defaultModel: 'claude-sonnet',
    embeddingModel: '',
    isDefault: false,
    isEnabled: true,
    clearApiKey: false,
  });
  it('omits a blank key on update (keep) and never sends an empty string', () => {
    const body = buildProviderRequest(base, true);
    expect('apiKey' in body && body.apiKey !== undefined).toBe(false);
    expect(JSON.stringify(body)).not.toContain('"apiKey"');
  });
  it('sends clearApiKey only when asked and no new key is given', () => {
    expect(buildProviderRequest({ ...base, clearApiKey: true }, true)).toMatchObject({
      clearApiKey: true,
    });
    expect(
      buildProviderRequest({ ...base, clearApiKey: true, apiKey: 'sk-new-key-123' }, true),
    ).not.toHaveProperty('clearApiKey');
  });
});

describe('buildProviderRequest (bedrock)', () => {
  it('sends the region and never an API key or endpoint override', () => {
    const values = providerFormSchema.parse({
      provider: 'bedrock',
      name: 'AWS',
      apiKey: 'should-not-be-sent',
      baseUrl: 'https://evil.example.com',
      region: 'eu-west-1',
      defaultModel: 'amazon.nova-micro-v1:0',
      embeddingModel: '',
      isDefault: false,
      isEnabled: true,
      clearApiKey: false,
    });
    const body = buildProviderRequest(values, false);
    expect(body).toMatchObject({ provider: 'bedrock', region: 'eu-west-1' });
    expect(JSON.stringify(body)).not.toContain('apiKey');
    expect(JSON.stringify(body)).not.toContain('baseUrl');
  });
  it('rejects a malformed region', () => {
    const r = providerFormSchema.safeParse({
      provider: 'bedrock',
      name: 'AWS',
      apiKey: '',
      baseUrl: '',
      region: 'not a region',
      defaultModel: 'm',
      embeddingModel: '',
      isDefault: false,
      isEnabled: true,
      clearApiKey: false,
    });
    expect(r.success).toBe(false);
  });
});

describe('ProviderDialog', () => {
  beforeEach(() => seedSession(['ai:config:read', 'ai:config:manage']));
  afterEach(() => vi.unstubAllGlobals());

  it('never shows the stored key: the field is empty, masked and optional on edit', async () => {
    const { calls } = mockApi({
      'GET /ai/models': () => MODELS,
      [`PATCH /ai/providers/${PROVIDER.id}`]: () => PROVIDER,
    });
    renderWithProviders(<ProviderDialog open onOpenChange={() => {}} provider={PROVIDER} />);
    const key = await screen.findByLabelText('API key');
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('type', 'password');
    expect(screen.getByText(/Stored key ••••1234\. Leave blank to keep it\./)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^Provider/ })).toBeDisabled();

    // Saving without touching the key leaves it out of the request.
    const name = screen.getByLabelText(/^Name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Production EU');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const sent = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
    expect(sent.name).toBe('Production EU');
    expect(sent).not.toHaveProperty('apiKey');
  });

  it('sends a new key only when one is typed', async () => {
    const { calls } = mockApi({
      'GET /ai/models': () => MODELS,
      [`PATCH /ai/providers/${PROVIDER.id}`]: () => PROVIDER,
    });
    renderWithProviders(<ProviderDialog open onOpenChange={() => {}} provider={PROVIDER} />);
    await userEvent.type(await screen.findByLabelText('API key'), 'sk-rotated-9999');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({
      apiKey: 'sk-rotated-9999',
    });
  });

  it('requires a key when creating an anthropic provider', async () => {
    const { calls } = mockApi({ 'GET /ai/models': () => MODELS });
    renderWithProviders(<ProviderDialog open onOpenChange={() => {}} first />);
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Prod');
    await waitFor(() => expect(calls.some((c) => c.path === '/ai/models')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    expect(await screen.findByText('An API key is required')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('bedrock: no key or base URL fields, free-text model ids, and the region is saved', async () => {
    const bedrock: AiProviderConfig = {
      ...PROVIDER,
      provider: 'bedrock',
      name: 'AWS',
      hasApiKey: false,
      keyLast4: null,
      region: 'eu-west-1',
      defaultModel: 'amazon.nova-micro-v1:0',
    };
    const { calls } = mockApi({
      'GET /ai/models': () => MODELS,
      [`PATCH /ai/providers/${bedrock.id}`]: () => bedrock,
    });
    renderWithProviders(<ProviderDialog open onOpenChange={() => {}} provider={bedrock} />);
    const region = await screen.findByLabelText(/AWS region/);
    expect(region).toHaveValue('eu-west-1');
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Base URL/)).not.toBeInTheDocument();
    const model = screen.getByLabelText(/^Default model/);
    expect(model).toHaveValue('amazon.nova-micro-v1:0');

    await userEvent.clear(region);
    await userEvent.type(region, 'us-east-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const sent = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ region: 'us-east-1', defaultModel: 'amazon.nova-micro-v1:0' });
    expect(sent).not.toHaveProperty('apiKey');
    expect(sent).not.toHaveProperty('baseUrl');
  });
});
