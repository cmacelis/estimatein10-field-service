import { dispatchError } from '../dispatcher/errors.js';

function scheduleLockKey(businessId, teamMemberId) {
  return `${businessId}:${teamMemberId}`;
}

export async function assertNoVisitScheduleConflict(client, {
  businessId,
  teamMemberId,
  scheduledStart,
  scheduledEnd,
  excludeVisitId = null,
}) {
  if (!teamMemberId) return;

  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtext('fsm.tech_schedule'),
       hashtext($1)
     )`,
    [scheduleLockKey(businessId, teamMemberId)],
  );

  const conflict = await client.query(
    `SELECT id
       FROM visits
      WHERE business_id = $1
        AND assigned_team_member_id = $2
        AND status IN ('scheduled', 'en_route', 'on_site')
        AND id <> COALESCE($5, '')
        AND scheduled_start < $4
        AND scheduled_end > $3
      LIMIT 1`,
    [
      businessId,
      teamMemberId,
      scheduledStart,
      scheduledEnd,
      excludeVisitId,
    ],
  );

  if (conflict.rows[0]) {
    throw dispatchError('TECH_SCHEDULE_CONFLICT', 422, {
      conflicting_visit_id: conflict.rows[0].id,
    });
  }
}
