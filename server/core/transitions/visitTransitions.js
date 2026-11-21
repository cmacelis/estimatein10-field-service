import { dispatchError } from '../dispatcher/errors.js';
import { assertNoVisitScheduleConflict } from './scheduleConflicts.js';

function requireAssignedTechOrAdmin(entity, actor) {
  if (actor.kind !== 'user') return;
  if (actor.role === 'owner' || actor.role === 'admin') return;
  if (entity.assigned_team_member_id === actor.team_member_id) return;
  throw dispatchError('VISIT_NOT_ASSIGNED_TO_TECH', 403);
}

function completionNotes(payload) {
  const notes = typeof payload.completion_notes === 'string'
    ? payload.completion_notes.trim()
    : '';
  if (!notes) throw dispatchError('COMPLETION_NOTES_REQUIRED', 400);
  return notes;
}

function parseVisitDate(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw dispatchError('INVALID_VISIT_DATETIME', 400, { field });
  }
  return date;
}

function parseAssignedTeamMemberId(value) {
  if (value == null) return null;
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    throw dispatchError('ASSIGNED_TEAM_MEMBER_REQUIRED', 400);
  }
  return id;
}

function registerVisitTransition(registry, {
  action,
  fromStatuses,
  nextStatus,
  validate = (payload) => payload || {},
  applyFields,
}) {
  registry.register({
    entityType: 'visit',
    action,
    isCreation: false,
    fromStatuses,
    allowedActorKinds: ['user'],
    allowedUserRoles: ['owner', 'admin', 'tech'],
    validate,
    async apply({ client, entity, actor, payload, now }) {
      requireAssignedTechOrAdmin(entity, actor);
      const fields = applyFields({ payload, now });
      const result = await client.query(
        `UPDATE visits
            SET status = $2,
                actual_start = COALESCE($3, actual_start),
                actual_end = COALESCE($4, actual_end),
                completion_notes = COALESCE($5, completion_notes),
                updated_at = $6
          WHERE id = $1
          RETURNING *`,
        [
          entity.id,
          nextStatus,
          fields.actual_start || null,
          fields.actual_end || null,
          fields.completion_notes || null,
          now(),
        ],
      );

      return { entity: result.rows[0] };
    },
  });
}

export function registerVisitTransitions(registry) {
  registry.register({
    entityType: 'visit',
    action: 'reschedule',
    isCreation: false,
    fromStatuses: ['scheduled', 'en_route'],
    allowedActorKinds: ['user'],
    allowedUserRoles: ['owner', 'admin'],
    validate(payload) {
      const scheduledStart = parseVisitDate(payload.scheduled_start, 'scheduled_start');
      const scheduledEnd = parseVisitDate(payload.scheduled_end, 'scheduled_end');
      if (scheduledEnd <= scheduledStart) {
        throw dispatchError('INVALID_VISIT_WINDOW', 400);
      }
      return {
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        assigned_team_member_id: parseAssignedTeamMemberId(payload.assigned_team_member_id),
      };
    },
    async apply({ client, entity, payload, actor, now }) {
      const assignedTeamMemberId = payload.assigned_team_member_id || entity.assigned_team_member_id;
      const previousTeamMemberId = entity.assigned_team_member_id || null;
      const changedAt = now();
      if (assignedTeamMemberId) {
        const teamMember = await client.query(
          `SELECT id
             FROM team_members
            WHERE business_id = $1
              AND id = $2
              AND is_active = TRUE
            LIMIT 1`,
          [entity.business_id, assignedTeamMemberId],
        );
        if (!teamMember.rows[0]) {
          throw dispatchError('ASSIGNED_TEAM_MEMBER_NOT_FOUND', 404);
        }
      }

      await assertNoVisitScheduleConflict(client, {
        businessId: entity.business_id,
        teamMemberId: assignedTeamMemberId,
        scheduledStart: payload.scheduled_start,
        scheduledEnd: payload.scheduled_end,
        excludeVisitId: entity.id,
      });

      const visitResult = await client.query(
        `UPDATE visits
            SET scheduled_start = $2,
                scheduled_end = $3,
                assigned_team_member_id = $4,
                updated_at = $5
          WHERE id = $1
          RETURNING *`,
        [entity.id, payload.scheduled_start, payload.scheduled_end, assignedTeamMemberId, changedAt],
      );

      await client.query(
        `UPDATE jobs
            SET scheduled_start = $2,
                scheduled_end = $3,
                primary_team_member_id = $4,
                updated_at = $5
          WHERE business_id = $6
            AND id = $1`,
        [
          entity.job_id,
          payload.scheduled_start,
          payload.scheduled_end,
          assignedTeamMemberId,
          changedAt,
          entity.business_id,
        ],
      );

      const outboxEvents = [];
      if (assignedTeamMemberId && assignedTeamMemberId !== actor.team_member_id) {
        outboxEvents.push({
          topic: 'visit.notify_schedule_changed',
          payload: {
            job_id: entity.job_id,
            visit_id: entity.id,
            team_member_id: assignedTeamMemberId,
            change_kind: assignedTeamMemberId === previousTeamMemberId ? 'rescheduled' : 'assigned',
          },
          idempotency_key: `visit.schedule_changed:${entity.id}:${assignedTeamMemberId}:${changedAt.toISOString()}`,
        });
      }
      if (
        previousTeamMemberId
        && previousTeamMemberId !== assignedTeamMemberId
        && previousTeamMemberId !== actor.team_member_id
      ) {
        outboxEvents.push({
          topic: 'visit.notify_schedule_changed',
          payload: {
            job_id: entity.job_id,
            visit_id: entity.id,
            team_member_id: previousTeamMemberId,
            change_kind: 'unassigned',
          },
          idempotency_key: `visit.schedule_changed:${entity.id}:${previousTeamMemberId}:${changedAt.toISOString()}`,
        });
      }

      return { entity: visitResult.rows[0], outboxEvents };
    },
  });

  registerVisitTransition(registry, {
    action: 'en_route',
    fromStatuses: ['scheduled'],
    nextStatus: 'en_route',
    applyFields: () => ({}),
  });

  registerVisitTransition(registry, {
    action: 'arrive',
    fromStatuses: ['scheduled', 'en_route'],
    nextStatus: 'on_site',
    applyFields: ({ now }) => ({
      actual_start: now(),
    }),
  });

  registerVisitTransition(registry, {
    action: 'complete',
    fromStatuses: ['on_site'],
    nextStatus: 'complete',
    validate(payload) {
      return {
        completion_notes: completionNotes(payload || {}),
      };
    },
    applyFields: ({ payload, now }) => ({
      actual_end: now(),
      completion_notes: payload.completion_notes,
    }),
  });
}
