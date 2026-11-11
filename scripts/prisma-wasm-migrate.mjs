#!/usr/bin/env node
/**
 * prisma-wasm-migrate — run Prisma migrations with the WebAssembly schema engine.
 *
 * Why: the Prisma CLI downloads a native `schema-engine` binary from binaries.prisma.sh. On networks where that
 * host is blocked (corporate proxies, sandboxed CI) `prisma migrate` cannot run. This script drives the same
 * schema engine compiled to WebAssembly (@prisma/schema-engine-wasm, pinned to the engine commit of the
 * installed `prisma` version) through the pg driver adapter, so the generated SQL is byte-for-byte what
 * `prisma migrate dev` would produce.
 *
 * Usage (from repo root, DATABASE_URL in env):
 *   node scripts/prisma-wasm-migrate.mjs create <name>   # create prisma/migrations/<ts>_<name>/migration.sql
 *   node scripts/prisma-wasm-migrate.mjs apply           # apply pending migrations (like `migrate deploy`)
 *   node scripts/prisma-wasm-migrate.mjs status          # diagnose history
 *   node scripts/prisma-wasm-migrate.mjs diff            # print SQL diff between the live DB and the schema
 *   node scripts/prisma-wasm-migrate.mjs reset           # DROP everything (dev only)
 *
 * Install the engine once (it is intentionally not a workspace dependency):
 *   npm i --prefix /opt/prisma-tools @prisma/schema-engine-wasm@<version matching prisma enginesVersion> @prisma/adapter-pg @prisma/driver-adapter-utils pg
 *   export PRISMA_WASM_TOOLS=/opt/prisma-tools
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const dbPkg = path.join(repoRoot, 'packages/database');
const schemaPath = path.join(dbPkg, 'prisma/schema.prisma');
const migrationsDir = path.join(dbPkg, 'prisma/migrations');
const toolsRoot = process.env.PRISMA_WASM_TOOLS ?? '/opt/prisma-tools';
const require = createRequire(path.join(toolsRoot, 'package.json'));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function loadEngine() {
  const pkgDir = path.join(toolsRoot, 'node_modules/@prisma/schema-engine-wasm');
  const bg = await import(path.join(pkgDir, 'schema_engine_bg.js'));
  const bytes = readFileSync(path.join(pkgDir, 'schema_engine_bg.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, { './schema_engine_bg.js': bg });
  bg.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start?.();
  return bg;
}

function schemasContainer() {
  return { files: [{ path: schemaPath, content: readFileSync(schemaPath, 'utf8') }] };
}

function migrationList() {
  mkdirSync(migrationsDir, { recursive: true });
  const lockPath = path.join(migrationsDir, 'migration_lock.toml');
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return {
    baseDir: migrationsDir,
    lockfile: {
      path: 'migration_lock.toml',
      content: existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null,
    },
    shadowDbInitScript: '',
    migrationDirectories: dirs.map((name) => {
      const file = path.join(migrationsDir, name, 'migration.sql');
      return {
        path: name,
        migrationFile: {
          path: 'migration.sql',
          content: existsSync(file)
            ? { tag: 'ok', value: readFileSync(file, 'utf8') }
            : { tag: 'error', value: 'missing migration.sql' },
        },
      };
    }),
  };
}

const filters = { externalTables: [], externalEnums: [] };

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { SchemaEngine } = await loadEngine();
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { bindMigrationAwareSqlAdapterFactory } = require('@prisma/driver-adapter-utils');
  // The engine expects an error-capturing adapter factory (every call returns { ok, value | error }).
  const adapter = bindMigrationAwareSqlAdapterFactory(new PrismaPg({ connectionString: url }));
  const engine = await SchemaEngine.new(
    { datamodels: [[schemaPath, readFileSync(schemaPath, 'utf8')]] },
    () => {},
    adapter,
  );

  try {
    switch (cmd) {
      case 'create': {
        const name = rest[0];
        if (!name) throw new Error('usage: create <name>');
        // Diff the live database (which must equal the applied migration history) against the schema.
        // This avoids needing a shadow database and yields the same SQL `prisma migrate dev` generates.
        const out = await engine.diff({
          from: { tag: 'schemaDatasource', ...schemasContainer(), configDir: dbPkg },
          to: { tag: 'schemaDatamodel', ...schemasContainer() },
          script: true,
          exitCode: true,
          filters,
        });
        const sql = (out.stdout ?? '').trim();
        if (!sql || out.exitCode !== 2) {
          console.log('No schema changes — nothing to create.');
          break;
        }
        const ts = new Date()
          .toISOString()
          .replace(/[-:TZ.]/g, '')
          .slice(0, 14);
        const dirName = `${ts}_${name.replace(/[^a-zA-Z0-9_]+/g, '_')}`;
        const dir = path.join(migrationsDir, dirName);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'migration.sql'), `${sql}\n`);
        const lockPath = path.join(migrationsDir, 'migration_lock.toml');
        if (!existsSync(lockPath)) {
          writeFileSync(
            lockPath,
            '# Please do not edit this file manually\n# It should be added in your version-control system (e.g., Git)\nprovider = "postgresql"\n',
          );
        }
        console.log(`Created ${path.relative(repoRoot, dir)} — run "apply" to execute it.`);
        break;
      }
      case 'apply': {
        const out = await engine.applyMigrations({ migrationsList: migrationList(), filters });
        console.log(
          out.appliedMigrationNames.length
            ? `Applied: ${out.appliedMigrationNames.join(', ')}`
            : 'Database is up to date.',
        );
        break;
      }
      case 'status': {
        const out = await engine.diagnoseMigrationHistory({
          migrationsList: migrationList(),
          optInToShadowDatabase: false,
          filters,
        });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      case 'diff': {
        // Live database (= applied migrations) vs. schema; no shadow database required.
        const out = await engine.diff({
          from: { tag: 'schemaDatasource', ...schemasContainer(), configDir: dbPkg },
          to: { tag: 'schemaDatamodel', ...schemasContainer() },
          script: true,
          exitCode: true,
          filters,
        });
        console.log(out.stdout ?? '-- (no differences)');
        process.exitCode = out.exitCode === 2 ? 2 : 0;
        break;
      }
      case 'reset': {
        await engine.reset({ filter: filters });
        console.log('Database reset.');
        break;
      }
      default:
        console.error('usage: prisma-wasm-migrate <create <name>|apply|status|diff|reset>');
        process.exitCode = 1;
    }
  } finally {
    engine.free();
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  if (err?.meta) console.error(JSON.stringify(err.meta, null, 2));
  if (err?.message?.includes('error id') || typeof err === 'object') {
    // Error-capturing adapters register errors by id; surface the original if present.
    const reg = globalThis.__prismaErrorRegistry;
    if (reg) console.error(reg);
  }
  process.exit(1);
});
