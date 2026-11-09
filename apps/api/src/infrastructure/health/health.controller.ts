import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, type HealthIndicatorResult } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { NoTenant, Public, SkipTransform } from '../../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
@Public()
@NoTenant()
@SkipTransform()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (PostgreSQL + Redis)' })
  @HealthCheck()
  ready() {
    return this.health.check([() => this.checkDatabase(), () => this.checkRedis()]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.ping();
      return { database: { status: 'up' } };
    } catch (error) {
      return { database: { status: 'down', message: (error as Error).message } };
    }
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return { redis: { status: 'up' } };
    } catch (error) {
      return { redis: { status: 'down', message: (error as Error).message } };
    }
  }
}
