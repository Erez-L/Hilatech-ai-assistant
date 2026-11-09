import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  type AdmissionCaps,
  type AdmissionRequest,
  type AdmissionVerdict,
  type Reserved,
  decideAdmission,
} from './budget.rules';

export const RESERVATION_TTL_MS = 15 * 60 * 1000;

/**
 * Holds the tokens/cost of AI calls that were admitted but have not finished yet, so concurrent
 * requests cannot all pass the same remaining budget. A reservation is released after the run
 * (when the real usage has been recorded) and expires on its own if the process dies.
 */
export interface ReservationStore {
  tryReserve(
    organizationId: string,
    reservationId: string,
    request: AdmissionRequest,
    caps: AdmissionCaps,
  ): Promise<AdmissionVerdict>;
  release(organizationId: string, reservationId: string): Promise<void>;
  outstanding(organizationId: string): Promise<Reserved>;
}

/** Process-local implementation: unit tests and the fallback when Redis is unreachable. */
export class InMemoryReservationStore implements ReservationStore {
  private readonly byOrg = new Map<
    string,
    Map<string, { tokens: number; costMicroUsd: number; expiresAt: number }>
  >();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = RESERVATION_TTL_MS,
  ) {}

  private live(organizationId: string) {
    const map = this.byOrg.get(organizationId) ?? new Map();
    for (const [id, r] of map) if (r.expiresAt <= this.now()) map.delete(id);
    this.byOrg.set(organizationId, map);
    return map;
  }

  async outstanding(organizationId: string): Promise<Reserved> {
    let tokens = 0;
    let costMicroUsd = 0;
    for (const r of this.live(organizationId).values()) {
      tokens += r.tokens;
      costMicroUsd += r.costMicroUsd;
    }
    return { tokens, costMicroUsd };
  }

  async tryReserve(
    organizationId: string,
    reservationId: string,
    request: AdmissionRequest,
    caps: AdmissionCaps,
  ): Promise<AdmissionVerdict> {
    const verdict = decideAdmission(caps, await this.outstanding(organizationId), request);
    if (verdict.allowed) {
      this.live(organizationId).set(reservationId, {
        tokens: request.tokens,
        costMicroUsd: request.costMicroUsd ?? 0,
        expiresAt: this.now() + this.ttlMs,
      });
    }
    return verdict;
  }

  async release(organizationId: string, reservationId: string): Promise<void> {
    this.byOrg.get(organizationId)?.delete(reservationId);
  }
}

/**
 * Atomic check-and-reserve: expired members are dropped, outstanding sums are computed and the new
 * reservation is added in ONE Lua script, so two requests cannot both fit into the same headroom.
 * Members are `id|tokens|microUsd`, scored by their expiry time.
 * Returns {allowed(1|0), scope(0 none|1 tokens|2 cost), reason(1 exhausted|2 would_exceed)}.
 */
const RESERVE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local member = ARGV[3]
local reqTokens = tonumber(ARGV[4])
local reqCost = tonumber(ARGV[5])
local capTokens = tonumber(ARGV[6])
local capCost = tonumber(ARGV[7])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local sumTokens = 0
local sumCost = 0
for _, m in ipairs(redis.call('ZRANGE', key, 0, -1)) do
  local _, t, c = string.match(m, '^(.-)|(%d+)|(%d+)$')
  sumTokens = sumTokens + tonumber(t)
  sumCost = sumCost + tonumber(c)
end
if capTokens >= 0 then
  if capTokens == 0 then return {0, 1, 1} end
  if sumTokens + reqTokens > capTokens then return {0, 1, 2} end
end
if capCost >= 0 then
  if capCost == 0 then return {0, 2, 1} end
  if sumCost + reqCost > capCost then return {0, 2, 2} end
end
redis.call('ZADD', key, now + ttl, member)
redis.call('PEXPIRE', key, ttl)
return {1, 0, 0}
`;

@Injectable()
export class RedisReservationStore implements ReservationStore {
  private readonly fallback = new InMemoryReservationStore();

  constructor(
    private readonly redis: RedisService,
    private readonly logger: Logger,
  ) {}

  private key(organizationId: string): string {
    return `hta:budget:reservations:${organizationId}`;
  }

  async tryReserve(
    organizationId: string,
    reservationId: string,
    request: AdmissionRequest,
    caps: AdmissionCaps,
  ): Promise<AdmissionVerdict> {
    try {
      const client = await this.redis.ensureConnected();
      const member = `${reservationId}|${Math.max(0, Math.round(request.tokens))}|${Math.max(0, Math.round(request.costMicroUsd ?? 0))}`;
      const result = (await client.eval(
        RESERVE_LUA,
        1,
        this.key(organizationId),
        Date.now(),
        RESERVATION_TTL_MS,
        member,
        Math.max(0, Math.round(request.tokens)),
        Math.max(0, Math.round(request.costMicroUsd ?? 0)),
        caps.tokens ?? -1,
        caps.costMicroUsd ?? -1,
      )) as [number, number, number];
      if (result[0] === 1) return { allowed: true };
      return {
        allowed: false,
        scope: result[1] === 2 ? 'cost' : 'tokens',
        reason: result[2] === 1 ? 'exhausted' : 'would_exceed',
      };
    } catch (error) {
      // Redis down: the already-recorded usage is still checked (caps); only cross-request
      // reservation is degraded to this process.
      this.logger.warn(
        { err: error, organizationId },
        'budget reservation store unavailable; using process-local reservations',
        RedisReservationStore.name,
      );
      return this.fallback.tryReserve(organizationId, reservationId, request, caps);
    }
  }

  async release(organizationId: string, reservationId: string): Promise<void> {
    await this.fallback.release(organizationId, reservationId);
    try {
      const client = await this.redis.ensureConnected();
      const key = this.key(organizationId);
      const members = await client.zrange(key, 0, -1);
      const mine = members.filter((m) => m.startsWith(`${reservationId}|`));
      if (mine.length) await client.zrem(key, ...mine);
    } catch (error) {
      // Expires on its own within RESERVATION_TTL_MS.
      this.logger.warn({ err: error, organizationId }, 'could not release budget reservation');
    }
  }

  async outstanding(organizationId: string): Promise<Reserved> {
    try {
      const client = await this.redis.ensureConnected();
      const members = await client.zrangebyscore(this.key(organizationId), Date.now(), '+inf');
      let tokens = 0;
      let costMicroUsd = 0;
      for (const m of members) {
        const match = /^.*\|(\d+)\|(\d+)$/.exec(m);
        if (match) {
          tokens += Number(match[1]);
          costMicroUsd += Number(match[2]);
        }
      }
      return { tokens, costMicroUsd };
    } catch {
      return this.fallback.outstanding(organizationId);
    }
  }
}
