import pg from 'pg';

const { Pool } = pg;

let sharedPool = null;
const CLIENT_ERROR_HANDLER = Symbol.for('estimatein10.fsmPgClientErrorHandler');

function logPgError(scope, error) {
  const message = error?.message || String(error);
  console.error(`[fsm-db] ${scope}: ${message}`);
}

export function attachFsmClientErrorHandler(client, logger = logPgError) {
  if (!client || client[CLIENT_ERROR_HANDLER]) return client;

  client[CLIENT_ERROR_HANDLER] = (error) => {
    logger('pg client error', error);
  };
  client.on?.('error', client[CLIENT_ERROR_HANDLER]);
  return client;
}

export function getFsmDatabaseUrl(env = process.env) {
  return env.FSM_DATABASE_URL || null;
}

export function getFsmConnectionOptions(env = process.env) {
  const databaseUrl = getFsmDatabaseUrl(env);
  if (!databaseUrl) return { databaseUrl: null, ssl: undefined };
  const url = new URL(databaseUrl);
  const mode = url.searchParams.get('sslmode');
  const tlsRequired = env.FSM_DATABASE_SSL === '1' || (mode && mode !== 'disable');
  if (!tlsRequired) return { databaseUrl, ssl: undefined };

  // pg allows URL parameters to override the supplied SSL object. Normalize
  // the URL as well so require/no-verify cannot disable certificate checks.
  const ca = env.FSM_DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  url.searchParams.delete('ssl');
  if (ca) {
    if (['sslrootcert', 'sslcert', 'sslkey'].some((key) => url.searchParams.has(key))) {
      throw new Error('Configure FSM database certificates in the URL or FSM_DATABASE_CA_CERT, not both.');
    }
    url.searchParams.delete('sslmode');
    url.searchParams.delete('uselibpqcompat');
  } else {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return { databaseUrl: url.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

export function createFsmPool(databaseUrl, options = {}) {
  if (!databaseUrl) return null;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: options.max ?? 5,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    ssl: options.ssl,
  });

  pool.on('connect', (client) => {
    attachFsmClientErrorHandler(client);
  });
  pool.on('error', (error) => {
    logPgError('pg pool idle client error', error);
  });

  return pool;
}

export function getSharedFsmPool(env = process.env) {
  if (sharedPool) return sharedPool;

  const { databaseUrl, ssl } = getFsmConnectionOptions(env);
  sharedPool = createFsmPool(databaseUrl, { ssl });

  return sharedPool;
}

export async function closeSharedFsmPool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.end();
}

export async function withFsmTransaction(pool, callback) {
  if (!pool) {
    throw new Error('FSM_DATABASE_URL is required before wiring FSM dispatcher transactions.');
  }

  const client = attachFsmClientErrorHandler(await pool.connect());
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL search_path = fsm, public");
    await client.query("SET LOCAL fsm.dispatcher_authorized = 'true'");

    const result = await callback(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    client.release();
  }
}
