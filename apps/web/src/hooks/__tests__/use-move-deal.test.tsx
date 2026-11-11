import * as React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DealBoard } from '@hilatech/contracts';
import { useMoveDeal } from '@/hooks/sales';
import { keys } from '@/lib/api/keys';
import { useSession } from '@/stores/session';
import { makeBoard } from '@/lib/__tests__/fixtures';

const move = vi.fn();
vi.mock('@/lib/api/deals', async (orig) => {
  const mod = await orig<Record<string, unknown> & { dealsApi: object }>();
  return { ...mod, dealsApi: { ...mod.dealsApi, move: (...args: unknown[]) => move(...args) } };
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const key = keys.dealBoard('org-1', { pipelineId: 'p' });
  qc.setQueryData(key, makeBoard());
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useMoveDeal(), { wrapper });
  return { qc, key, hook };
}

describe('useMoveDeal', () => {
  beforeEach(() => {
    move.mockReset();
    useSession.setState({ activeOrganizationId: 'org-1' });
  });

  it('updates the board optimistically before the server answers', async () => {
    let resolve!: (v: unknown) => void;
    move.mockReturnValue(new Promise((r) => (resolve = r)));
    const { qc, key, hook } = setup();
    hook.result.current.mutate({ id: 'a', body: { stageId: 's2' } });
    await waitFor(() => {
      const board = qc.getQueryData<DealBoard>(key)!;
      expect(board.columns[1]!.deals.map((d) => d.id)).toEqual(['a']);
    });
    resolve({});
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  });

  it('rolls the board back when the server rejects the move', async () => {
    move.mockRejectedValue(new Error('boom'));
    const { qc, key, hook } = setup();
    const before = JSON.stringify(qc.getQueryData(key));
    hook.result.current.mutate({ id: 'a', body: { stageId: 's2' } });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    // after the rollback the cache holds the original board again (an invalidation may refetch later)
    expect(JSON.stringify(qc.getQueryData(key))).toBe(before);
  });
});
