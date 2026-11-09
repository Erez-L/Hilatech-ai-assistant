import { PgVectorKnowledgeSearcher } from '@hilatech/ai-engine';
import { type KnowledgeSearchRequest, type KnowledgeSearchResult } from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { withEngineErrors } from '../ai/core/ai-errors';

@Injectable()
export class KnowledgeSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searcher: PgVectorKnowledgeSearcher,
  ) {}

  /**
   * Semantic search over the organization's ready documents. Explicit `knowledgeBaseIds` must all belong
   * to the organization (404 otherwise, so ids of other tenants are indistinguishable from unknown ids).
   * Embedding usage is recorded by the engine (`AiRequestLog` operation `embed`, `ai_tokens`).
   */
  async search(
    tenant: TenantContext,
    request: KnowledgeSearchRequest,
  ): Promise<KnowledgeSearchResult> {
    if (request.knowledgeBaseIds && request.knowledgeBaseIds.length > 0) {
      const ids = [...new Set(request.knowledgeBaseIds)];
      const found = await this.prisma.client.knowledgeBase.count({
        where: { organizationId: tenant.organizationId, id: { in: ids } },
      });
      if (found !== ids.length) throw AppException.notFound('Knowledge base');
    }
    return withEngineErrors(() =>
      this.searcher.query(tenant.organizationId, request, { userId: tenant.userId }),
    );
  }
}
