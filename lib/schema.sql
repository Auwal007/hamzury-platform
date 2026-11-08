-- hamzury schema for supabase postgres. safe to run more than once (the server runs it on start).
-- timestamps are text COLLATE "C" 'YYYY-MM-DD HH:MM:SS' in utc, exactly as the pages and the rules expect.
-- row level security is on for every table with no policies: supabase's public api (anon key) cannot read
-- or write anything. only the server, connecting with the database password, can.
SELECT pg_advisory_xact_lock(724001);

CREATE OR REPLACE FUNCTION now_ts() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') $$;
CREATE OR REPLACE FUNCTION ts_ago(i interval) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT to_char((now() - i) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') $$;
CREATE OR REPLACE FUNCTION utc_day(i interval DEFAULT '0'::interval) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT to_char((now() - i) AT TIME ZONE 'UTC', 'YYYY-MM-DD') $$;
CREATE OR REPLACE FUNCTION month_start() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD') $$;

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, username text COLLATE "C" NOT NULL UNIQUE, display_name text COLLATE "C" NOT NULL,
  password_hash text COLLATE "C" NOT NULL, role text COLLATE "C" NOT NULL, venture text COLLATE "C", active integer NOT NULL DEFAULT 1,
  phone text COLLATE "C" NOT NULL DEFAULT '', mfa_secret text COLLATE "C" NOT NULL DEFAULT '', mfa_pending text COLLATE "C" NOT NULL DEFAULT '',
  mfa_last_step bigint NOT NULL DEFAULT -1, created_at text COLLATE "C" NOT NULL DEFAULT now_ts());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text COLLATE "C" PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id), csrf text COLLATE "C" NOT NULL, expires_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS clients (
  id serial PRIMARY KEY, ref text COLLATE "C" NOT NULL UNIQUE, name text COLLATE "C" NOT NULL, business text COLLATE "C" NOT NULL DEFAULT '',
  phone text COLLATE "C" NOT NULL, phone_key text COLLATE "C" NOT NULL, email text COLLATE "C" NOT NULL DEFAULT '', path text COLLATE "C" NOT NULL,
  intake text COLLATE "C" NOT NULL DEFAULT '{}', status text COLLATE "C" NOT NULL DEFAULT 'new', notes text COLLATE "C" NOT NULL DEFAULT '',
  owner_user_id integer REFERENCES users(id), last_update_at text COLLATE "C",
  created_at text COLLATE "C" NOT NULL DEFAULT now_ts(), updated_at text COLLATE "C" NOT NULL DEFAULT now_ts(),
  source text COLLATE "C" NOT NULL DEFAULT 'holding', plan_eta text COLLATE "C" NOT NULL DEFAULT '', pay_auth text COLLATE "C" NOT NULL DEFAULT '',
  hold integer NOT NULL DEFAULT 0, purged_at text COLLATE "C", last_seen_at text COLLATE "C");
CREATE TABLE IF NOT EXISTS client_sessions (
  token_hash text COLLATE "C" PRIMARY KEY, client_id integer NOT NULL REFERENCES clients(id), csrf text COLLATE "C" NOT NULL, expires_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS packages (
  id serial PRIMARY KEY, venture text COLLATE "C" NOT NULL, name text COLLATE "C" NOT NULL, summary text COLLATE "C" NOT NULL DEFAULT '',
  inclusions text COLLATE "C" NOT NULL DEFAULT '[]', value text COLLATE "C" NOT NULL DEFAULT '', duration text COLLATE "C" NOT NULL DEFAULT '',
  price_minor bigint NOT NULL, onboarding text COLLATE "C" NOT NULL DEFAULT '[]', stage text COLLATE "C" NOT NULL DEFAULT 'structure',
  active integer NOT NULL DEFAULT 1, created_at text COLLATE "C" NOT NULL DEFAULT now_ts(),
  code text COLLATE "C" NOT NULL DEFAULT '', level text COLLATE "C" NOT NULL DEFAULT 'standard', exclusions text COLLATE "C" NOT NULL DEFAULT '[]',
  basis text COLLATE "C" NOT NULL DEFAULT 'fixed', price_status text COLLATE "C" NOT NULL DEFAULT 'approved', external text COLLATE "C" NOT NULL DEFAULT '',
  format text COLLATE "C" NOT NULL DEFAULT 'document', grp text COLLATE "C" NOT NULL DEFAULT '', requires text COLLATE "C" NOT NULL DEFAULT '[]',
  "overlaps" text COLLATE "C" NOT NULL DEFAULT '[]', focus text COLLATE "C" NOT NULL DEFAULT '', vat integer NOT NULL DEFAULT 1);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pkg_code ON packages(code) WHERE code != '';
CREATE TABLE IF NOT EXISTS recommendations (
  id serial PRIMARY KEY, client_id integer NOT NULL UNIQUE REFERENCES clients(id),
  heard text COLLATE "C" NOT NULL DEFAULT '', advice text COLLATE "C" NOT NULL DEFAULT '', status text COLLATE "C" NOT NULL DEFAULT 'draft',
  published_at text COLLATE "C", updated_at text COLLATE "C" NOT NULL DEFAULT now_ts(),
  management text COLLATE "C" NOT NULL DEFAULT '', auto integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS rec_items (
  id serial PRIMARY KEY, recommendation_id integer NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  package_id integer NOT NULL REFERENCES packages(id), price_minor bigint NOT NULL,
  note text COLLATE "C" NOT NULL DEFAULT '', priority integer NOT NULL DEFAULT 2, stage text COLLATE "C" NOT NULL, sort integer NOT NULL DEFAULT 0,
  level text COLLATE "C" NOT NULL DEFAULT 'standard', client_has integer NOT NULL DEFAULT 0, renewal text COLLATE "C" NOT NULL DEFAULT 'none',
  renewal_minor bigint NOT NULL DEFAULT 0, quote text COLLATE "C" NOT NULL DEFAULT 'fixed', request text COLLATE "C" NOT NULL DEFAULT '',
  requested_at text COLLATE "C", assess text COLLATE "C" NOT NULL DEFAULT '', client_saved integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY, client_id integer NOT NULL REFERENCES clients(id), reference text COLLATE "C" NOT NULL UNIQUE,
  total_minor bigint NOT NULL, status text COLLATE "C" NOT NULL DEFAULT 'pending', method text COLLATE "C" NOT NULL DEFAULT '',
  transfer_note text COLLATE "C" NOT NULL DEFAULT '', paid_at text COLLATE "C", confirmed_by text COLLATE "C",
  created_at text COLLATE "C" NOT NULL DEFAULT now_ts(),
  kind text COLLATE "C" NOT NULL DEFAULT 'purchase', subscription_id integer, subtotal_minor bigint, vat_minor bigint NOT NULL DEFAULT 0,
  terms_version text COLLATE "C", proposal_version text COLLATE "C", accepted_at text COLLATE "C", refunded_at text COLLATE "C", renewal_period text COLLATE "C");
CREATE UNIQUE INDEX IF NOT EXISTS ux_renewal_period ON orders(subscription_id, renewal_period)
  WHERE kind = 'renewal' AND renewal_period IS NOT NULL AND status NOT IN ('cancelled', 'refund_due', 'refunded');
CREATE TABLE IF NOT EXISTS order_lines (
  id serial PRIMARY KEY, order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rec_item_id integer NOT NULL REFERENCES rec_items(id), price_minor bigint NOT NULL);
CREATE TABLE IF NOT EXISTS engagements (
  id serial PRIMARY KEY, client_id integer NOT NULL REFERENCES clients(id), order_id integer NOT NULL REFERENCES orders(id),
  rec_item_id integer NOT NULL UNIQUE REFERENCES rec_items(id), package_id integer NOT NULL REFERENCES packages(id),
  name text COLLATE "C" NOT NULL, venture text COLLATE "C" NOT NULL, price_minor bigint NOT NULL,
  status text COLLATE "C" NOT NULL DEFAULT 'awaiting_onboarding', progress integer NOT NULL DEFAULT 0,
  onboarding text COLLATE "C" NOT NULL DEFAULT '{}', onboarding_at text COLLATE "C",
  file_path text COLLATE "C", file_name text COLLATE "C", delivered_at text COLLATE "C",
  created_at text COLLATE "C" NOT NULL DEFAULT now_ts(), updated_at text COLLATE "C" NOT NULL DEFAULT now_ts(),
  assigned_user_id integer REFERENCES users(id), due_date text COLLATE "C" NOT NULL DEFAULT '', brief text COLLATE "C" NOT NULL DEFAULT '',
  attachments text COLLATE "C" NOT NULL DEFAULT '{}', assigned_at text COLLATE "C", update_requested_at text COLLATE "C", handover text COLLATE "C" NOT NULL DEFAULT '{}',
  attachments_purged_at text COLLATE "C", file_purged_at text COLLATE "C");
CREATE TABLE IF NOT EXISTS updates (
  id serial PRIMARY KEY, client_id integer NOT NULL REFERENCES clients(id),
  engagement_id integer REFERENCES engagements(id), progress text COLLATE "C" NOT NULL, blocker text COLLATE "C" NOT NULL DEFAULT '',
  next_action text COLLATE "C" NOT NULL, author text COLLATE "C" NOT NULL, created_at text COLLATE "C" NOT NULL DEFAULT now_ts());
CREATE TABLE IF NOT EXISTS reports (
  id serial PRIMARY KEY, engagement_id integer NOT NULL REFERENCES engagements(id), author text COLLATE "C" NOT NULL,
  progress integer NOT NULL, done text COLLATE "C" NOT NULL, blocker text COLLATE "C" NOT NULL DEFAULT '', next_step text COLLATE "C" NOT NULL,
  ready integer NOT NULL DEFAULT 0, status text COLLATE "C" NOT NULL DEFAULT 'submitted', holding_note text COLLATE "C" NOT NULL DEFAULT '',
  reviewed_by text COLLATE "C", reviewed_at text COLLATE "C", created_at text COLLATE "C" NOT NULL DEFAULT now_ts());
CREATE TABLE IF NOT EXISTS client_links (
  token_hash text COLLATE "C" PRIMARY KEY, client_id integer NOT NULL REFERENCES clients(id), dest text COLLATE "C" NOT NULL,
  expires_at bigint NOT NULL, created_by text COLLATE "C" NOT NULL, last_used_at text COLLATE "C", created_at text COLLATE "C" NOT NULL DEFAULT now_ts());
CREATE TABLE IF NOT EXISTS events (
  day text COLLATE "C" NOT NULL, flow text COLLATE "C" NOT NULL, step integer NOT NULL, n integer NOT NULL DEFAULT 0, PRIMARY KEY (day, flow, step));
CREATE TABLE IF NOT EXISTS audit (
  id serial PRIMARY KEY, actor text COLLATE "C" NOT NULL, event text COLLATE "C" NOT NULL, entity text COLLATE "C" NOT NULL, entity_id integer,
  summary text COLLATE "C" NOT NULL DEFAULT '', at text COLLATE "C" NOT NULL DEFAULT now_ts());
CREATE TABLE IF NOT EXISTS subscriptions (
  id serial PRIMARY KEY, client_id integer NOT NULL REFERENCES clients(id), engagement_id integer, rec_item_id integer UNIQUE,
  name text COLLATE "C" NOT NULL, amount_minor bigint NOT NULL, method text COLLATE "C" NOT NULL DEFAULT 'transfer', status text COLLATE "C" NOT NULL DEFAULT 'active',
  next_due text COLLATE "C" NOT NULL, failures integer NOT NULL DEFAULT 0, last_paid_at text COLLATE "C", cancel_at text COLLATE "C",
  created_at text COLLATE "C" NOT NULL DEFAULT now_ts(), updated_at text COLLATE "C" NOT NULL DEFAULT now_ts(), bill_day integer);
CREATE TABLE IF NOT EXISTS settings (key text COLLATE "C" PRIMARY KEY, value text COLLATE "C" NOT NULL, updated_by text COLLATE "C", updated_at text COLLATE "C");
CREATE TABLE IF NOT EXISTS rate_limits (key text COLLATE "C" PRIMARY KEY, n integer NOT NULL, expires bigint NOT NULL);
-- replaces the old file locks: one payment or file operation at a time, across every serverless instance
CREATE TABLE IF NOT EXISTS op_locks (name text COLLATE "C" PRIMARY KEY, holder text COLLATE "C" NOT NULL, until bigint NOT NULL);

CREATE INDEX IF NOT EXISTS ix_clients_phone ON clients(phone_key);
CREATE INDEX IF NOT EXISTS ix_eng_client ON engagements(client_id);
CREATE INDEX IF NOT EXISTS ix_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS ix_updates_client ON updates(client_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','clients','client_sessions','packages','recommendations','rec_items','orders',
    'order_lines','engagements','updates','reports','client_links','events','audit','subscriptions','settings','rate_limits','op_locks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
