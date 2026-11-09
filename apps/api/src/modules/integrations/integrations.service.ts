import {
  AuditAction,
  type CreateIntegrationRequest,
  type Integration as IntegrationDto,
  type IntegrationCatalogueEntry,
  type IntegrationConfig,
  type IntegrationSecrets,
  type IntegrationTestResult,
  type UpdateIntegrationRequest,
  integrationConfigSchema,
  integrationSecretsSchema,
} from '@hilatech/contracts';
import { type Integration, Prisma } from '@hilatech/database';
import {
  SsrfError,
  assertSafeUrlShape,
  buildN8nHeaders,
  buildRestHeaders,
  joinUrl,
  safeRequest,
} from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { SecretBoxService } from '../../infrastructure/crypto/secret-box.service';
import { OutboundPolicyService } from '../../infrastructure/http/outbound-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { INTEGRATION_CATALOGUE, catalogueEntry, isLiveKind, secretProblems } from './integrations.catalog';

const TEST_TIMEOUT_MS = 8_000;

export function toIntegration(row: Integration, secretKeys: string[]): IntegrationDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    name: row.name,
    config: (row.config ?? {}) as Record<string, unknown>,
    hasSecrets: secretKeys.length > 0,
    secretKeys,
    isEnabled: row.isEnabled,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface IntegrationStatusEntry {
  kind: IntegrationCatalogueEntry['kind'];
  liveSupport: IntegrationCatalogueEntry['liveSupport'];
  connected: number;
  total: number;
  /** `available` = live kind that can be connected; `not_configured` = configuration-only kind (no provider). */
  availability: 'available' | 'not_configured';
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly secrets: SecretBoxService,
    private readonly outbound: OutboundPolicyService,
    private readonly logger: Logger,
  ) {}

  catalogue(): readonly IntegrationCatalogueEntry[] {
    return INTEGRATION_CATALOGUE;
  }

  async status(tenant: TenantContext): Promise<IntegrationStatusEntry[]> {
    const rows = await this.prisma.client.integration.findMany({
      where: { organizationId: tenant.organizationId },
      select: { kind: true, status: true },
    });
    return INTEGRATION_CATALOGUE.map((entry) => {
      const mine = rows.filter((r) => r.kind === entry.kind);
      return {
        kind: entry.kind,
        liveSupport: entry.liveSupport,
        connected: mine.filter((r) => r.status === 'connected').length,
        total: mine.length,
        availability: isLiveKind(entry.kind) ? 'available' : 'not_configured',
      };
    });
  }

  async list(tenant: TenantContext): Promise<IntegrationDto[]> {
    const rows = await this.prisma.client.integration.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.present(r));
  }

  async get(tenant: TenantContext, id: string): Promise<IntegrationDto> {
    return this.present(await this.require(tenant, id));
  }

  /** Stores the connection (credentials encrypted) and, for live kinds, runs a first connectivity test. */
  async connect(
    tenant: TenantContext,
    dto: CreateIntegrationRequest,
    meta: RequestMeta,
  ): Promise<IntegrationDto> {
    const secrets = dto.secrets ?? {};
    this.assertValid(dto.config, secrets);
    this.assertConfigUrl(dto.config);
    const clash = await this.prisma.client.integration.findFirst({
      where: { organizationId: tenant.organizationId, kind: dto.config.kind, name: dto.name },
      select: { id: true },
    });
    if (clash) throw AppException.conflict('An integration with this name already exists for this kind');

    const created = await this.prisma.client.integration.create({
      data: {
        organizationId: tenant.organizationId,
        kind: dto.config.kind,
        name: dto.name,
        config: dto.config as unknown as Prisma.InputJsonObject,
        encryptedSecrets: this.encryptSecrets(tenant.organizationId, secrets),
        isEnabled: dto.isEnabled,
        status: 'unconfigured',
      },
    });
    await this.audit.log({
      action: AuditAction.INTEGRATION_CONNECTED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'integration',
      targetId: created.id,
      metadata: { kind: created.kind, name: created.name, secretKeys: Object.keys(secrets) },
      request: meta,
    });
    if (isLiveKind(created.kind)) {
      await this.runTest(created, secrets);
      return this.present(await this.require(tenant, created.id));
    }
    return this.present(created);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateIntegrationRequest,
    meta: RequestMeta,
  ): Promise<IntegrationDto> {
    const existing = await this.require(tenant, id);
    if (dto.config && dto.config.kind !== existing.kind) {
      throw AppException.validation('The kind of an integration cannot change', [
        { path: 'config.kind', message: `Must stay "${existing.kind}"`, code: 'custom' },
      ]);
    }
    const config = (dto.config ?? existing.config) as IntegrationConfig;
    const currentSecrets = this.decryptSecrets(tenant.organizationId, existing.encryptedSecrets);
    const nextSecrets = mergeSecrets(currentSecrets, dto.secrets);
    this.assertValid(config, nextSecrets);
    if (dto.config) this.assertConfigUrl(dto.config);
    if (dto.name && dto.name !== existing.name) {
      const clash = await this.prisma.client.integration.findFirst({
        where: { organizationId: tenant.organizationId, kind: existing.kind, name: dto.name, NOT: { id: existing.id } },
        select: { id: true },
      });
      if (clash) throw AppException.conflict('An integration with this name already exists for this kind');
    }
    const changedConnection = dto.config !== undefined || dto.secrets !== undefined;
    const updated = await this.prisma.client.integration.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.config !== undefined ? { config: dto.config as unknown as Prisma.InputJsonObject } : {}),
        ...(dto.secrets !== undefined
          ? { encryptedSecrets: this.encryptSecrets(tenant.organizationId, nextSecrets) }
          : {}),
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
        ...(changedConnection ? { status: 'unconfigured', lastError: null, lastCheckedAt: null } : {}),
      },
    });
    await this.audit.log({
      action: AuditAction.INTEGRATION_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'integration',
      targetId: existing.id,
      metadata: {
        changes: Object.keys(dto).filter((k) => k !== 'secrets'),
        secretKeysChanged: dto.secrets ? Object.keys(dto.secrets) : [],
      },
      request: meta,
    });
    return this.present(updated);
  }

  async disconnect(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.integration.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    if (result.count === 0) throw AppException.notFound('Integration');
    await this.audit.log({
      action: AuditAction.INTEGRATION_DISCONNECTED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'integration',
      targetId: id,
      request: meta,
    });
  }

  async test(tenant: TenantContext, id: string, meta: RequestMeta): Promise<IntegrationTestResult> {
    const row = await this.require(tenant, id);
    const secrets = this.decryptSecrets(tenant.organizationId, row.encryptedSecrets);
    const result = await this.runTest(row, secrets);
    await this.audit.log({
      action: AuditAction.INTEGRATION_TESTED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'integration',
      targetId: row.id,
      metadata: { kind: row.kind, ok: result.ok, status: result.status },
      request: meta,
    });
    return result;
  }

  // -- Internals ----------------------------------------------------------------------------------

  /** Performs the kind-specific check and persists status/lastError. Never throws for network problems. */
  private async runTest(row: Integration, secrets: IntegrationSecrets): Promise<IntegrationTestResult> {
    const checkedAt = new Date();
    let result: Omit<IntegrationTestResult, 'checkedAt'>;
    if (!isLiveKind(row.kind)) {
      result = {
        ok: false,
        status: 'unconfigured',
        latencyMs: null,
        message: `${catalogueEntry(row.kind).name} is configuration-only in this release: no connection test or delivery is available until a provider integration ships.`,
      };
    } else {
      result = await this.checkLive(row, secrets);
    }
    await this.prisma.client.integration.update({
      where: { id: row.id },
      data: {
        status: result.status,
        lastCheckedAt: checkedAt,
        lastError: result.ok ? null : result.message.slice(0, 500),
      },
    });
    return { ...result, checkedAt: checkedAt.toISOString() };
  }

  private async checkLive(
    row: Integration,
    secrets: IntegrationSecrets,
  ): Promise<Omit<IntegrationTestResult, 'checkedAt'>> {
    const config = integrationConfigSchema.safeParse(row.config);
    if (!config.success || (config.data.kind !== 'rest' && config.data.kind !== 'n8n')) {
      return { ok: false, status: 'error', latencyMs: null, message: 'Stored configuration is invalid' };
    }
    const cfg = config.data;
    const headers =
      cfg.kind === 'rest' ? buildRestHeaders(cfg, secrets) : buildN8nHeaders(secrets);
    const url = cfg.kind === 'n8n' ? joinUrl(cfg.baseUrl, '/healthz') : cfg.baseUrl;
    try {
      const res = await safeRequest(url, {
        ...this.outbound.policy,
        method: 'GET',
        headers: { accept: '*/*', 'user-agent': 'HilaTech-Integration-Test/1.0', ...headers },
        timeoutMs: TEST_TIMEOUT_MS,
        maxResponseBytes: 1024,
      });
      const s = res.status;
      if (s === 401 || s === 403) {
        return { ok: false, status: 'error', latencyMs: res.durationMs, message: `Reachable, but the credentials were rejected (HTTP ${s})` };
      }
      if (s >= 500) {
        return { ok: false, status: 'error', latencyMs: res.durationMs, message: `The remote service answered HTTP ${s}` };
      }
      if (cfg.kind === 'n8n' && s === 404) {
        // Older/proxied n8n without /healthz: fall back to reachability of the base URL.
        const base = await safeRequest(cfg.baseUrl, {
          ...this.outbound.policy,
          method: 'GET',
          headers: { 'user-agent': 'HilaTech-Integration-Test/1.0', ...headers },
          timeoutMs: TEST_TIMEOUT_MS,
          maxResponseBytes: 512,
        });
        const ok = base.status < 500 && base.status !== 401 && base.status !== 403;
        return {
          ok,
          status: ok ? 'connected' : 'error',
          latencyMs: base.durationMs,
          message: ok ? `n8n base URL reachable (HTTP ${base.status}; /healthz not exposed)` : `n8n answered HTTP ${base.status}`,
        };
      }
      return {
        ok: true,
        status: 'connected',
        latencyMs: res.durationMs,
        message: `Reachable (HTTP ${s})`,
      };
    } catch (error) {
      const message =
        error instanceof SsrfError
          ? `Target blocked by the outbound policy: ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Connection failed';
      this.logger.warn({ integrationId: row.id, kind: row.kind, reason: message }, 'Integration test failed', IntegrationsService.name);
      return { ok: false, status: 'error', latencyMs: null, message: message.slice(0, 300) };
    }
  }

  private assertValid(config: IntegrationConfig, secrets: IntegrationSecrets): void {
    const problems = secretProblems(config, secrets);
    if (problems.length > 0) {
      throw AppException.validation('Invalid integration credentials', problems.map((p) => ({ ...p, code: 'custom' })));
    }
  }

  private assertConfigUrl(config: IntegrationConfig): void {
    const urls: Array<[string, string | undefined]> = [];
    if (config.kind === 'rest' || config.kind === 'n8n') urls.push(['config.baseUrl', config.baseUrl]);
    for (const [path, url] of urls) {
      if (!url) continue;
      try {
        assertSafeUrlShape(url, this.outbound.policy);
      } catch (error) {
        if (error instanceof SsrfError) {
          throw AppException.validation(`Invalid URL: ${error.message}`, [{ path, message: error.message, code: 'custom' }]);
        }
        throw error;
      }
    }
  }

  private encryptSecrets(organizationId: string, secrets: IntegrationSecrets): string | null {
    const keys = Object.keys(secrets).filter((k) => secrets[k as keyof IntegrationSecrets] !== undefined);
    if (keys.length === 0) return null;
    return this.secrets.encrypt(organizationId, JSON.stringify(secrets));
  }

  private decryptSecrets(organizationId: string, envelope: string | null): IntegrationSecrets {
    if (!envelope) return {};
    try {
      const parsed = integrationSecretsSchema.safeParse(JSON.parse(this.secrets.decrypt(organizationId, envelope)));
      return parsed.success ? parsed.data : {};
    } catch (error) {
      if (error instanceof AppException) throw error;
      this.logger.error({ organizationId }, 'Could not decrypt integration secrets', IntegrationsService.name);
      return {};
    }
  }

  /** Public shape: secret NAMES only. */
  private present(row: Integration): IntegrationDto {
    let keys: string[] = [];
    if (row.encryptedSecrets) {
      keys = Object.keys(this.decryptSecrets(row.organizationId, row.encryptedSecrets));
    }
    return toIntegration(row, keys);
  }

  private async require(tenant: TenantContext, id: string): Promise<Integration> {
    const row = await this.prisma.client.integration.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Integration');
    return row;
  }
}

/** Merge rule from the contract: provided keys overwrite; an empty string deletes the key. */
export function mergeSecrets(
  current: IntegrationSecrets,
  patch: IntegrationSecrets | undefined,
): IntegrationSecrets {
  if (!patch) return current;
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === '') delete next[key];
    else next[key] = value;
  }
  return next as IntegrationSecrets;
}
