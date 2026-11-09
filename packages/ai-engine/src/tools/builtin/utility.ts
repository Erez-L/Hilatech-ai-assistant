import { Permission } from '@hilatech/contracts';
import { z } from 'zod';

import type { ToolDefinition } from '../types';

export const timeNowTool: ToolDefinition = {
  key: 'time.now',
  name: 'Current time',
  description: 'Returns the current date and time (UTC ISO-8601) and the day of week.',
  category: 'utility',
  riskLevel: 'read',
  requiredPermission: null,
  input: z.object({}),
  async execute(ctx) {
    const now = ctx.now();
    return {
      ok: true,
      summary: `Now is ${now.toISOString()}`,
      data: {
        iso: now.toISOString(),
        dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      },
    };
  },
};

/**
 * Knowledge retrieval lands with Priority 4. Until the retrieval service is wired in, the tool exists so
 * agents can be configured with it, and reports `not_configured` instead of pretending to search.
 */
export interface KnowledgeSearcher {
  search(params: {
    organizationId: string;
    query: string;
    knowledgeBaseIds?: string[];
    limit: number;
  }): Promise<Array<{ documentId: string; title: string; chunk: string; score: number }>>;
}

export function createKnowledgeSearchTool(searcher: KnowledgeSearcher | null): ToolDefinition {
  return {
    key: 'knowledge.search',
    name: 'Search knowledge base',
    description:
      "Semantic search over the organization's uploaded documents. Returns the most relevant passages with sources.",
    category: 'knowledge',
    riskLevel: 'read',
    requiredPermission: Permission.KNOWLEDGE_READ,
    input: z.object({
      query: z.string().trim().min(1).max(500),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    async execute(ctx, input) {
      if (!searcher) {
        return {
          ok: false,
          summary: 'Knowledge base retrieval is not configured yet',
          error: 'not_configured',
        };
      }
      const hits = await searcher.search({
        organizationId: ctx.organizationId,
        query: input.query,
        limit: input.limit,
      });
      return { ok: true, summary: `${hits.length} passage(s) found`, data: hits };
    },
  };
}
