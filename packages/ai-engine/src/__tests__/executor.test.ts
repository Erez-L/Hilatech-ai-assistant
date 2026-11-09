import type { PrismaClient } from '@hilatech/database';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ToolExecutor } from '../tools/executor';
import { ToolRegistry } from '../tools/registry';
import { timeNowTool } from '../tools/builtin/utility';
import {
  noopLogger,
  type ToolContext,
  type ToolDefinition,
  type ToolPrincipal,
} from '../tools/types';

const writeTool: ToolDefinition = {
  key: 'crm.create_lead',
  name: 'Create lead',
  description: 'test write tool',
  category: 'crm',
  riskLevel: 'write',
  requiredPermission: 'leads:create',
  input: z.object({ title: z.string().min(1) }),
  async execute(_ctx, input) {
    return { ok: true, summary: `created ${input.title}`, data: { id: 'lead-1' } };
  },
};

const dangerousTool: ToolDefinition = {
  key: 'admin.delete_everything',
  name: 'Delete everything',
  description: 'never autonomous',
  category: 'admin',
  riskLevel: 'dangerous',
  requiredPermission: 'organization:delete',
  input: z.object({}),
  async execute() {
    throw new Error('must not run');
  },
};

const slowTool: ToolDefinition = {
  key: 'test.slow',
  name: 'Slow',
  description: 'sleeps',
  category: 'test',
  riskLevel: 'read',
  requiredPermission: null,
  input: z.object({}),
  timeoutMs: 20,
  async execute(ctx) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 500);
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
    return { ok: true, summary: 'done' };
  },
};

function ctx(): ToolContext {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    agentId: null,
    executionId: null,
    prisma: {} as PrismaClient,
    logger: noopLogger,
    signal: new AbortController().signal,
    now: () => new Date('2026-01-01T00:00:00Z'),
  };
}

const registry = new ToolRegistry().registerAll([timeNowTool, writeTool, dangerousTool, slowTool]);

describe('ToolExecutor permission layer', () => {
  const principal: ToolPrincipal = {
    allowedTools: ['time.now', 'crm.create_lead', 'admin.delete_everything', 'test.slow'],
    permissions: ['leads:create', 'organization:delete'],
    allowWrite: true,
  };

  it('executes an allowed read tool (function names use __ for dots)', async () => {
    const outcome = await new ToolExecutor(registry).execute(ctx(), principal, {
      id: '1',
      name: 'time__now',
      input: {},
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.toolKey).toBe('time.now');
    expect((outcome.result.data as { iso: string }).iso).toBe('2026-01-01T00:00:00.000Z');
  });

  it('denies unknown tools and tools outside the allow-list', async () => {
    const exec = new ToolExecutor(registry);
    const unknown = await exec.execute(ctx(), principal, { id: '1', name: 'nope', input: {} });
    expect(unknown.status).toBe('denied');
    expect(unknown.status === 'denied' && unknown.reason).toBe('unknown_tool');
    const notAllowed = await exec.execute(
      ctx(),
      { ...principal, allowedTools: ['time.now'] },
      { id: '2', name: 'crm__create_lead', input: { title: 'x' } },
    );
    expect(notAllowed.status === 'denied' && notAllowed.reason).toBe('not_allowed_for_agent');
  });

  it('requires the tool permission and the write grant', async () => {
    const exec = new ToolExecutor(registry);
    const noPerm = await exec.execute(
      ctx(),
      { ...principal, permissions: [] },
      { id: '1', name: 'crm__create_lead', input: { title: 'x' } },
    );
    expect(noPerm.status === 'denied' && noPerm.reason).toBe('missing_permission');
    const noWrite = await exec.execute(
      ctx(),
      { ...principal, allowWrite: false },
      { id: '2', name: 'crm__create_lead', input: { title: 'x' } },
    );
    expect(noWrite.status === 'denied' && noWrite.reason).toBe('write_not_allowed');
    const ok = await exec.execute(ctx(), principal, {
      id: '3',
      name: 'crm__create_lead',
      input: { title: 'Big deal' },
    });
    expect(ok.status).toBe('ok');
  });

  it('never executes dangerous tools autonomously', async () => {
    const outcome = await new ToolExecutor(registry).execute(ctx(), principal, {
      id: '1',
      name: 'admin__delete_everything',
      input: {},
    });
    expect(outcome.status).toBe('requires_authorization');
  });

  it('validates input and reports issues without throwing', async () => {
    const outcome = await new ToolExecutor(registry).execute(ctx(), principal, {
      id: '1',
      name: 'crm__create_lead',
      input: { title: '' },
    });
    expect(outcome.status === 'denied' && outcome.reason).toBe('invalid_input');
    expect(outcome.result.summary).toContain('title');
  });

  it('times out slow tools and calls the outcome hook for every call', async () => {
    const onOutcome = vi.fn();
    const exec = new ToolExecutor(registry, { onOutcome });
    const outcome = await exec.execute(ctx(), principal, {
      id: '1',
      name: 'test__slow',
      input: {},
    });
    expect(outcome.status).toBe('error');
    expect(outcome.result.error).toMatch(/timed out/);
    expect(onOutcome).toHaveBeenCalledTimes(1);
  });

  it('exposes a JSON-schema catalogue for the UI and model', () => {
    const specs = registry.toSpecs(['crm.create_lead']);
    expect(specs[0]?.name).toBe('crm__create_lead');
    expect(
      (specs[0]?.inputSchema as { properties: Record<string, unknown> }).properties,
    ).toHaveProperty('title');
    const dto = registry.toDtos().find((t) => t.key === 'admin.delete_everything');
    expect(dto?.riskLevel).toBe('dangerous');
  });
});
