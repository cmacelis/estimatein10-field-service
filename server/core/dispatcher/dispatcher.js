import { withFsmTransaction } from '../postgres.js';
import { DispatchError, dispatchError } from './errors.js';

const TABLE_BY_ENTITY = {
  estimate: 'estimates',
  job: 'jobs',
  visit: 'visits',
  invoice: 'invoices',
  payment: 'payments',
};

function actorId(actor) {
  if (actor.kind === 'user') return actor.team_member_id;
  if (actor.kind === 'public_token') return actor.token_id;
  if (actor.kind === 'integration') return actor.integration;
  return actor.source || actor.kind;
}

function authorize(spec, actor) {
  if (!spec.allowedActorKinds.includes(actor.kind)) {
    throw dispatchError('ACTOR_KIND_FORBIDDEN', 403);
  }
  if (actor.kind === 'user' && spec.allowedUserRoles && !spec.allowedUserRoles.includes(actor.role)) {
    throw dispatchError('ROLE_FORBIDDEN', 403);
  }
}

function businessIdForActor(actor) {
  if (actor.kind === 'user' || actor.kind === 'public_token') return actor.business_id;
  if (actor.kind === 'integration' && actor.business_id) return actor.business_id;
  return null;
}

function idempotencyKeyForInput(input, spec, actorBusinessId) {
  if (input.actor.kind !== 'user') return null;
  if (!actorBusinessId) return null;
  if (typeof input.http_idempotency_key !== 'string') return null;

  const externalKey = input.http_idempotency_key.trim();
  if (!externalKey) return null;

  return `${actorBusinessId}:${spec.entityType}.${spec.action}:${externalKey}`;
}

async function acquireIdempotencyLock(client, key) {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtext('fsm.idempotency_log'),
       hashtext($1)
     )`,
    [key],
  );
}

async function findIdempotencyReplay(client, key) {
  const result = await client.query(
    `SELECT response_entity_jsonb, event_id
       FROM idempotency_log
      WHERE key = $1`,
    [key],
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    entity: row.response_entity_jsonb,
    event_id: row.event_id,
  };
}

async function insertIdempotencyReplay(client, key, response, now) {
  if (!key) return;
  await client.query(
    `INSERT INTO idempotency_log (
       key, response_entity_jsonb, event_id, created_at
     ) VALUES ($1, $2, $3, $4)`,
    [
      key,
      response.entity,
      response.event_id,
      now(),
    ],
  );
}

async function insertEventLog(client, { spec, actor, businessId, entityId, fromStatus, toStatus, payload, errorCode, outcome = 'committed', now, id }) {
  const eventId = id();
  await client.query(
    `INSERT INTO event_log (
       id, business_id, entity_type, entity_id, action, outcome,
       from_status, to_status, actor_kind, actor_id, actor_role, actor_ip,
       external_event_id, payload_jsonb, diff_jsonb, error_code, occurred_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17
     )`,
    [
      eventId,
      businessId,
      spec.entityType,
      entityId,
      spec.action,
      outcome,
      fromStatus,
      toStatus,
      actor.kind,
      actorId(actor),
      actor.kind === 'user' ? actor.role : null,
      actor.ip || null,
      actor.kind === 'integration' ? actor.external_event_id : null,
      payload,
      {},
      errorCode || null,
      now(),
    ],
  );
  return eventId;
}

async function insertRejectedEventAfterRollback(pool, eventInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL search_path = fsm, public");
    await insertEventLog(client, eventInput);
    await client.query('COMMIT');
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

async function insertOutboxEvents(client, businessId, outboxEvents, { id, now }) {
  for (const event of outboxEvents || []) {
    await client.query(
      `INSERT INTO outbox (
         id, business_id, topic, payload_jsonb, scheduled_for, status,
         attempts, last_error, idempotency_key, delivered_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'pending', 0, NULL, $6, NULL, $7)`,
      [
        id(),
        businessId,
        event.topic,
        event.payload || {},
        event.scheduled_for || now(),
        event.idempotency_key || null,
        now(),
      ],
    );
  }
}

export class Dispatcher {
  constructor({ pool, registry, id, now = () => new Date() }) {
    this.pool = pool;
    this.registry = registry;
    this.id = id;
    this.now = now;
  }

  async dispatch(input) {
    const spec = this.registry.get(input.entity_type, input.action);
    if (!spec) throw dispatchError('UNKNOWN_TRANSITION', 404);

    const payload = spec.validate ? spec.validate(input.payload || {}) : (input.payload || {});
    authorize(spec, input.actor);
    const actorBusinessId = businessIdForActor(input.actor);
    const idempotencyKey = idempotencyKeyForInput(input, spec, actorBusinessId);
    let rejectedEventInput = null;

    try {
      return await withFsmTransaction(this.pool, async (client) => {
        if (idempotencyKey) {
          await acquireIdempotencyLock(client, idempotencyKey);
          const replay = await findIdempotencyReplay(client, idempotencyKey);
          if (replay) return replay;
        }

        let entity = null;
        const table = TABLE_BY_ENTITY[spec.entityType];

        if (!spec.isCreation) {
          if (!table) throw dispatchError('UNKNOWN_ENTITY_TABLE', 500);
          const entityResult = await client.query(
            `SELECT * FROM ${table} WHERE id = $1 AND business_id = $2 FOR UPDATE`,
            [input.entity_id, actorBusinessId],
          );
          entity = entityResult.rows[0] || null;
          if (!entity) throw dispatchError('NOT_FOUND', 404);
          if (entity.deleted_at) throw dispatchError('SOFT_DELETED', 409);
          if (input.actor.kind === 'public_token' && entity.public_token !== input.actor.token_id) {
            rejectedEventInput = {
              spec,
              actor: input.actor,
              businessId: entity.business_id,
              entityId: entity.id,
              fromStatus: entity.status,
              toStatus: null,
              payload,
              errorCode: 'TOKEN_ROTATED',
              outcome: 'rejected',
              now: this.now,
              id: this.id,
            };
            throw dispatchError('TOKEN_ROTATED', 410);
          }
          if (!spec.fromStatuses.includes(entity.status)) {
            rejectedEventInput = {
              spec,
              actor: input.actor,
              businessId: entity.business_id,
              entityId: entity.id,
              fromStatus: entity.status,
              toStatus: null,
              payload,
              errorCode: 'INVALID_STATE_TRANSITION',
              outcome: 'rejected',
              now: this.now,
              id: this.id,
            };
            throw dispatchError('INVALID_STATE_TRANSITION', 409, {
              from: entity.status,
              action: input.action,
            });
          }
        }

        const fromStatus = entity?.status || null;
        let result;
        try {
          result = await spec.apply({
            client,
            entity,
            payload,
            actor: input.actor,
            now: this.now,
            id: this.id,
          });
        } catch (error) {
          if (error instanceof DispatchError && entity) {
            rejectedEventInput = {
              spec,
              actor: input.actor,
              businessId: entity.business_id,
              entityId: entity.id,
              fromStatus,
              toStatus: null,
              payload,
              errorCode: error.code,
              outcome: 'rejected',
              now: this.now,
              id: this.id,
            };
          }
          throw error;
        }

        const responseEntity = result.entity;
        const entityId = responseEntity?.id || input.entity_id;
        const businessId = responseEntity?.business_id || entity?.business_id || actorBusinessId;

        const eventId = await insertEventLog(client, {
          spec,
          actor: input.actor,
          businessId,
          entityId,
          fromStatus,
          toStatus: responseEntity?.status || result.toStatus || null,
          payload,
          now: this.now,
          id: this.id,
        });

        await insertOutboxEvents(client, businessId, result.outboxEvents, {
          id: this.id,
          now: this.now,
        });

        const response = {
          entity: responseEntity,
          event_id: eventId,
        };

        await insertIdempotencyReplay(client, idempotencyKey, response, this.now);

        return response;
      });
    } catch (error) {
      if (rejectedEventInput) {
        try {
          await insertRejectedEventAfterRollback(this.pool, rejectedEventInput);
        } catch (auditError) {
          error.auditError = auditError;
        }
      }
      throw error;
    }
  }
}
