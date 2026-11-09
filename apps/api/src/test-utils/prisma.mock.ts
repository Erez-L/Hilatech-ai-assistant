/* eslint-disable @typescript-eslint/no-explicit-any */
import { type PrismaService } from '../infrastructure/prisma/prisma.service';

type ModelName =
  | 'user'
  | 'organization'
  | 'organizationMember'
  | 'role'
  | 'permission'
  | 'invitation'
  | 'refreshToken'
  | 'passwordResetToken'
  | 'emailVerificationToken'
  | 'auditLog'
  | 'subscription'
  | 'usageRecord'
  | 'contact'
  | 'lead'
  | 'leadNote'
  | 'leadActivity'
  | 'conversation'
  | 'message'
  | 'notification';

type ModelMock = {
  findUnique: jest.Mock;
  findUniqueOrThrow: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  upsert: jest.Mock;
  delete: jest.Mock;
  deleteMany: jest.Mock;
  count: jest.Mock;
  aggregate: jest.Mock;
  groupBy: jest.Mock;
};

export type PrismaClientMock = Record<ModelName, ModelMock> & { $transaction: jest.Mock };

/**
 * Deep auto-mock of `PrismaService` for unit tests: any `client.<model>.<method>` access yields a cached
 * `jest.Mock`. `$transaction` runs callbacks against the same mock client (or resolves arrays).
 */
export function createPrismaMock(): { service: PrismaService; client: PrismaClientMock } {
  const models = new Map<string, Record<string, jest.Mock>>();
  const client: any = new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined;
        if (prop === '$transaction') return transaction;
        if (prop === 'then') return undefined;
        let model = models.get(prop);
        if (!model) {
          model = new Proxy({} as Record<string, jest.Mock>, {
            get(target, method: string | symbol) {
              if (typeof method !== 'string') return undefined;
              if (!(method in target)) target[method] = jest.fn();
              return target[method];
            },
          });
          models.set(prop, model);
        }
        return model;
      },
    },
  );
  const transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(client);
    if (Array.isArray(arg)) return Promise.all(arg);
    return undefined;
  });
  const service = {
    client,
    ping: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  } as unknown as PrismaService;
  return { service, client };
}

export function createAuditMock() {
  return { log: jest.fn().mockResolvedValue(undefined), list: jest.fn() };
}

export function createLoggerMock() {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    fatal: jest.fn(),
  };
}

export function createConfigMock(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
    get isProduction() {
      return values.isProduction === true;
    },
    get isTest() {
      return values.isTest === true;
    },
  };
}
