CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA fsm;
SET search_path = fsm, public;
CREATE TABLE businesses(id text PRIMARY KEY, name text NOT NULL, timezone text NOT NULL DEFAULT 'America/New_York');
CREATE TABLE team_members(id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses, name text NOT NULL, email text NOT NULL, role text NOT NULL CHECK(role IN ('owner','admin','tech')), is_active boolean NOT NULL DEFAULT true);
CREATE TABLE customers(id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses, display_name text NOT NULL, email text NOT NULL);
CREATE TABLE properties(id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses, current_owner_customer_id text REFERENCES customers, address_line1 text NOT NULL, city text NOT NULL);
CREATE TABLE equipment(id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses, property_id text NOT NULL REFERENCES properties, equipment_type text NOT NULL, manufacturer text NOT NULL, model text NOT NULL, serial text NOT NULL);
CREATE TABLE jobs(
 id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses, customer_id text NOT NULL REFERENCES customers,
 property_id text NOT NULL REFERENCES properties, job_number integer NOT NULL, title text NOT NULL, description text,
 status text NOT NULL CHECK(status IN ('unscheduled','scheduled','in_progress','on_hold','completed','cancelled')),
 primary_team_member_id text REFERENCES team_members, scheduled_start timestamptz, scheduled_end timestamptz,
 completed_at timestamptz, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id, job_number)
);
CREATE TABLE visits(
 id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses, job_id text NOT NULL REFERENCES jobs,
 visit_type text NOT NULL CHECK(visit_type IN ('diagnostic','work','follow_up','quote')), sequence_number integer NOT NULL DEFAULT 1,
 status text NOT NULL CHECK(status IN ('scheduled','en_route','on_site','complete','no_show','cancelled')),
 scheduled_start timestamptz NOT NULL, scheduled_end timestamptz NOT NULL,
 actual_start timestamptz, actual_end timestamptz, assigned_team_member_id text REFERENCES team_members,
 notes text, completion_notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(scheduled_end > scheduled_start), UNIQUE(job_id, sequence_number),
 EXCLUDE USING gist(business_id WITH =, assigned_team_member_id WITH =, tstzrange(scheduled_start, scheduled_end, '[)') WITH &&)
 WHERE(assigned_team_member_id IS NOT NULL AND status IN ('scheduled','en_route','on_site'))
);
CREATE TABLE event_log(
 id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses, entity_type text NOT NULL, entity_id text NOT NULL,
 action text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('committed','rejected')), from_status text, to_status text,
 actor_kind text NOT NULL, actor_id text, actor_role text, actor_ip inet, external_event_id text,
 payload_jsonb jsonb, diff_jsonb jsonb, error_code text, occurred_at timestamptz NOT NULL
);
CREATE TABLE idempotency_log(key text PRIMARY KEY, response_entity_jsonb jsonb NOT NULL, event_id text NOT NULL REFERENCES event_log, created_at timestamptz NOT NULL);
CREATE TABLE outbox(
 id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses, topic text NOT NULL, payload_jsonb jsonb NOT NULL,
 scheduled_for timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 last_error text, idempotency_key text, delivered_at timestamptz, created_at timestamptz NOT NULL
);
-- Status changes must pass through the extracted transactional dispatcher.
CREATE FUNCTION reject_unauthorized_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND coalesce(current_setting('fsm.dispatcher_authorized',true),'false') <> 'true' THEN
  RAISE EXCEPTION 'Use the dispatcher to change status';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER visits_status_guard BEFORE UPDATE ON visits FOR EACH ROW EXECUTE FUNCTION reject_unauthorized_status_change();
CREATE TRIGGER jobs_status_guard BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION reject_unauthorized_status_change();
