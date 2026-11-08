// database access. production: supabase postgres (DATABASE_URL). local and tests: pglite, an embedded postgres.
// queries are written with ? placeholders and run inside one transaction per tx() call, like the old sqlite connections.
import { readFileSync } from 'node:fs';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const toDollar = sql => { let n = 0; return sql.replace(/\?/g, () => '$' + (++n)); };

function wrap(run) {
  // c.all / c.get / c.run / c.val: the small query surface the routes use
  const c = {
    all: async (sql, ...params) => (await run(toDollar(sql), params.flat())).rows,
    get: async (sql, ...params) => (await run(toDollar(sql), params.flat())).rows[0],
    run: async (sql, ...params) => run(toDollar(sql), params.flat()),
    val: async (sql, ...params) => { const r = (await run(toDollar(sql), params.flat())).rows[0]; return r ? Object.values(r)[0] : undefined; },
  };
  return c;
}

async function pgliteDb(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(dir || undefined, { parsers: { 20: Number, 1700: Number } });
  await pg.exec(SCHEMA);
  let chain = Promise.resolve();  // pglite has one connection: queue transactions so they never interleave
  return {
    kind: 'pglite',
    tx(fn) {
      const next = chain.then(() => pg.transaction(async t => fn(wrap(async (sql, params) => {
        const r = await t.query(sql, params);
        return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
      }))));
      chain = next.catch(() => {});
      return next;
    },
    exec: sql => pg.exec(sql),
    close: () => pg.close(),
  };
}

async function postgresDb(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    prepare: false,  // supabase's transaction pooler (port 6543) does not keep prepared statements
    max: Number(process.env.HAMZURY_DB_POOL || 3),
    idle_timeout: 20,
    connect_timeout: 15,
    types: { bigint: { to: 20, from: [20, 1700], serialize: x => String(x), parse: x => Number(x) } },
    onnotice: () => {},
  });
  return {
    kind: 'postgres',
    tx: fn => sql.begin(t => fn(wrap(async (text, params) => {
      const r = await t.unsafe(text, params);
      return { rows: [...r], rowCount: r.count };
    }))),
    exec: text => sql.unsafe(text).simple(),
    close: () => sql.end({ timeout: 5 }),
  };
}

let shared;
export async function openDb(url = process.env.DATABASE_URL || '') {
  if (!url || url.startsWith('pglite:')) return pgliteDb(url.replace(/^pglite:/, '').replace(/^memory$/, ''));
  const db = await postgresDb(url);
  if (process.env.HAMZURY_MIGRATE_ON_START !== '0') await db.exec(SCHEMA);
  return db;
}

export function sharedDb() {
  shared ??= openDb().catch(e => { shared = undefined; throw e; });
  return shared;
}
