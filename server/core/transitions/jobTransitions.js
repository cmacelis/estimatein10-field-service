import { dispatchError } from '../dispatcher/errors.js';

function requirePrimaryTechOrAdmin(entity, actor) {
  if (actor.kind !== 'user') return;
  if (actor.role === 'owner' || actor.role === 'admin') return;
  if (entity.primary_team_member_id === actor.team_member_id) return;
  throw dispatchError('JOB_NOT_ASSIGNED_TO_TECH', 403);
}

async function assertVisitsReadyToComplete(client, entity) {
  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int AS total_count,
       COUNT(*) FILTER (WHERE status = 'complete')::int AS complete_count,
       COUNT(*) FILTER (WHERE status NOT IN ('complete', 'cancelled', 'no_show'))::int AS open_count
     FROM visits
     WHERE business_id = $1
       AND job_id = $2`,
    [entity.business_id, entity.id],
  );
  const counts = rows[0] || {};
  if (Number(counts.total_count || 0) === 0) {
    throw dispatchError('JOB_HAS_NO_VISITS', 422);
  }
  if (Number(counts.complete_count || 0) === 0) {
    throw dispatchError('JOB_HAS_NO_COMPLETED_VISITS', 422);
  }
  if (Number(counts.open_count || 0) > 0) {
    throw dispatchError('OPEN_VISITS_REMAIN', 422);
  }
}

export function registerJobTransitions(registry) {
  registry.register({
    entityType: 'job',
    action: 'complete',
    isCreation: false,
    fromStatuses: ['scheduled', 'in_progress'],
    allowedActorKinds: ['user'],
    allowedUserRoles: ['owner', 'admin', 'tech'],
    validate(payload) {
      return {
        completion_notes: typeof payload.completion_notes === 'string' && payload.completion_notes.trim()
          ? payload.completion_notes.trim()
          : null,
      };
    },
    async apply({ client, entity, actor, now }) {
      requirePrimaryTechOrAdmin(entity, actor);
      await assertVisitsReadyToComplete(client, entity);

      const result = await client.query(
        `UPDATE jobs
            SET status = 'completed',
                completed_at = $2,
                updated_at = $3
          WHERE id = $1
          RETURNING *`,
        [entity.id, now(), now()],
      );

      return {
        entity: result.rows[0],
      };
    },
  });

}
