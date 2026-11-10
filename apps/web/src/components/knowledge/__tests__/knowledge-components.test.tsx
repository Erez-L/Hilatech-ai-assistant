import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, seedSession } from '@/test/render';
import { json, mockApi } from '@/test/fetch';
import { UploadZone } from '../upload-zone';
import { RetrievalPanel } from '../retrieval-panel';
import { DocumentStatusBadge } from '../document-status-badge';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

beforeEach(() => seedSession(['knowledge:read', 'knowledge:manage', 'ai:config:manage']));
afterEach(() => vi.unstubAllGlobals());

describe('UploadZone', () => {
  it('uploads a file as multipart and shows server errors per file', async () => {
    let n = 0;
    const { fetch } = mockApi({
      'POST /knowledge/bases/b1/documents': () =>
        n++ === 0
          ? json({ data: { id: 'd1', status: 'uploaded' } }, 201)
          : json(
              { error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' } },
              413,
            ),
    });
    renderWithProviders(<UploadZone baseId="b1" onNotConfigured={() => {}} />);
    const input = screen.getByLabelText('Choose files to upload');
    await userEvent.upload(input, new File(['hello'], 'a.txt', { type: 'text/plain' }));
    expect(await screen.findByText(/Uploaded — processing/)).toBeInTheDocument();
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    await userEvent.upload(input, new File(['x'], 'b.md'));
    expect(await screen.findByText('The request is too large.')).toBeInTheDocument();
  });

  it('rejects unsupported types client-side without calling the API', async () => {
    const { calls } = mockApi({});
    renderWithProviders(<UploadZone baseId="b1" onNotConfigured={() => {}} />);
    await userEvent.upload(
      screen.getByLabelText('Choose files to upload'),
      new File(['x'], 'virus.exe'),
      { applyAccept: false },
    );
    expect(await screen.findByText(/Unsupported file type/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('reports AI_NOT_CONFIGURED to the page', async () => {
    mockApi({
      'POST /knowledge/bases/b1/documents': () =>
        json({ error: { code: 'AI_NOT_CONFIGURED', message: 'no provider' } }, 409),
    });
    const onNotConfigured = vi.fn();
    renderWithProviders(<UploadZone baseId="b1" onNotConfigured={onNotConfigured} />);
    await userEvent.upload(
      screen.getByLabelText('Choose files to upload'),
      new File(['x'], 'a.txt'),
    );
    await waitFor(() => expect(onNotConfigured).toHaveBeenCalled());
  });
});

describe('RetrievalPanel', () => {
  it('shows hits with source attribution and score', async () => {
    const { calls } = mockApi({
      'POST /knowledge/search': () => ({
        hits: [
          {
            chunkId: 'c1',
            documentId: 'd1',
            knowledgeBaseId: '11111111-1111-4111-8111-aaaaaaaaaaaa',
            documentTitle: 'Refund policy',
            index: 2,
            content: 'Refunds within 30 days.',
            score: 0.8123,
            metadata: {},
          },
        ],
        model: 'mock-embedding',
        tookMs: 12,
      }),
    });
    renderWithProviders(
      <RetrievalPanel
        baseId="11111111-1111-4111-8111-aaaaaaaaaaaa"
        bases={[{ id: '11111111-1111-4111-8111-aaaaaaaaaaaa', name: 'Handbook' } as never]}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /^Query/ }), 'refunds');
    await userEvent.click(screen.getByRole('button', { name: 'Run search' }));
    const results = await screen.findByRole('region', { name: 'Search results' });
    expect(results).toHaveTextContent('Refund policy');
    expect(results).toHaveTextContent('Chunk 3');
    expect(results).toHaveTextContent('Score 0.812');
    expect(results).toHaveTextContent('Handbook');
    expect(calls[0]!.body).toMatchObject({
      query: 'refunds',
      knowledgeBaseIds: ['11111111-1111-4111-8111-aaaaaaaaaaaa'],
      limit: 5,
    });
  });

  it('validates the query and shows the setup empty state on AI_NOT_CONFIGURED', async () => {
    mockApi({
      'POST /knowledge/search': () =>
        json({ error: { code: 'AI_NOT_CONFIGURED', message: 'no provider' } }, 409),
    });
    renderWithProviders(<RetrievalPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Run search' }));
    expect(await screen.findByText(/Enter a question/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /^Query/ }), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Run search' }));
    expect(await screen.findByText('AI isn’t set up for this organization')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings → AI/ })).toHaveAttribute(
      'href',
      '/settings/ai',
    );
  });
});

describe('DocumentStatusBadge', () => {
  it('labels every status', () => {
    renderWithProviders(
      <>
        {(['uploaded', 'processing', 'ready', 'failed'] as const).map((s) => (
          <DocumentStatusBadge key={s} status={s} />
        ))}
      </>,
    );
    for (const l of ['Uploaded', 'Processing', 'Ready', 'Failed']) {
      expect(screen.getByText(l)).toBeInTheDocument();
    }
  });
});
