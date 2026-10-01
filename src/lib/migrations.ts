// Schema changes, applied in order on first database use (see db.ts).
// Never edit a migration that has shipped; add a new one.
export const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
CREATE TABLE settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('manager', 'worker')),
  pin_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE push_subscriptions (
  endpoint text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  site_lat double precision NOT NULL,
  site_lng double precision NOT NULL,
  radius_m integer NOT NULL DEFAULT 150,
  scheduled_at timestamptz,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  require_leave_photo boolean NOT NULL DEFAULT false,
  require_work_photos boolean NOT NULL DEFAULT false,
  require_notes boolean NOT NULL DEFAULT false,
  require_signature boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'arrived', 'completed', 'cancelled')),
  arrived_at timestamptz,
  left_at timestamptz,
  completed_at timestamptz,
  notes text NOT NULL DEFAULT '',
  signature_name text NOT NULL DEFAULT '',
  signature_file text,
  signed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_assigned_idx ON jobs (assigned_to, status);
CREATE INDEX jobs_scheduled_idx ON jobs (scheduled_at);

CREATE TABLE job_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('arrival', 'work', 'leave')),
  file_key text NOT NULL,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  distance_m double precision,
  on_site boolean NOT NULL DEFAULT false,
  live_camera boolean NOT NULL DEFAULT true,
  device_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_photos_job_idx ON job_photos (job_id, created_at);

CREATE TABLE files (
  key text PRIMARY KEY,
  content_type text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: 2,
    // Supabase publishes the public schema through its REST API to anyone holding the
    // project's anon key. This app only reaches the database from its own server (as the
    // tables' owner, which row level security doesn't apply to), so shut that door:
    // RLS on with no policies, and no grants for the API roles. Harmless elsewhere.
    sql: `
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings', 'users', 'sessions', 'push_subscriptions', 'jobs', 'job_photos', 'files', 'schema_migrations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    FOREACH t IN ARRAY ARRAY['settings', 'users', 'sessions', 'push_subscriptions', 'jobs', 'job_photos', 'files', 'schema_migrations'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
    END LOOP;
    -- Tables added by later migrations start closed too.
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'could not change default privileges for %', r;
    END;
  END LOOP;
END $$;
`,
  },
  {
    id: 3,
    // Browsers a person has logged in on. Their login attempts have their own counter, so
    // someone guessing PINs from elsewhere can't lock the owner out of their own phone.
    sql: `
CREATE TABLE login_devices (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_devices_user_idx ON login_devices (user_id);
ALTER TABLE login_devices ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    EXECUTE format('REVOKE ALL ON TABLE public.login_devices FROM %I', r);
  END LOOP;
END $$;
`,
  },
  {
    id: 4,
    // Anti-cheat and review. Photos keep the full GPS reading, fingerprints of the image
    // (exact and look-alike), the phone (a random browser ID) and internet country they
    // came from, any warning signs found, and the manager's review. Jobs can ask for a
    // selfie and a code the customer gives the worker; customer steps skipped for a reason
    // wait for review. Passkeys let people log in with their fingerprint or face.
    sql: `
ALTER TABLE job_photos
  ADD COLUMN altitude_m double precision,
  ADD COLUMN altitude_accuracy_m double precision,
  ADD COLUMN heading_deg double precision,
  ADD COLUMN speed_mps double precision,
  ADD COLUMN fix_time timestamptz,
  ADD COLUMN sha256 text,
  ADD COLUMN phash bit(256),
  ADD COLUMN selfie_key text,
  ADD COLUMN selfie_sha256 text,
  ADD COLUMN browser_id text,
  ADD COLUMN ip_country text,
  ADD COLUMN flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN review text NOT NULL DEFAULT 'none'
    CHECK (review IN ('none', 'pending', 'approved', 'rejected')),
  ADD COLUMN request_reason text,
  ADD COLUMN request_note text NOT NULL DEFAULT '',
  ADD COLUMN reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_note text NOT NULL DEFAULT '';
CREATE INDEX job_photos_pending_idx ON job_photos (created_at) WHERE review = 'pending';
CREATE INDEX job_photos_sha256_idx ON job_photos (sha256);
CREATE INDEX job_photos_selfie_sha256_idx ON job_photos (selfie_sha256);
CREATE INDEX job_photos_user_time_idx ON job_photos (user_id, created_at);
CREATE INDEX job_photos_browser_idx ON job_photos (browser_id, created_at);

ALTER TABLE jobs
  ADD COLUMN require_selfie boolean NOT NULL DEFAULT false,
  ADD COLUMN require_customer_code boolean NOT NULL DEFAULT false,
  ADD COLUMN customer_code text,
  ADD COLUMN code_confirmed_at timestamptz,
  ADD COLUMN code_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN pin_from_photo boolean NOT NULL DEFAULT false;

-- A customer step (signature, code) the worker skipped with a reason, for review. Like
-- photos, a visit's skips are the ones made since its arrival photo.
CREATE TABLE job_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  step text NOT NULL CHECK (step IN ('signature', 'code')),
  reason text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  review text NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT ''
);
CREATE INDEX job_skips_job_idx ON job_skips (job_id, created_at);
CREATE INDEX job_skips_pending_idx ON job_skips (created_at) WHERE review = 'pending';

ALTER TABLE users
  ADD COLUMN notice_version integer NOT NULL DEFAULT 0,
  ADD COLUMN notice_accepted_at timestamptz;

-- How a session was started: with a PIN, or with a passkey.
ALTER TABLE sessions ADD COLUMN method text NOT NULL DEFAULT 'pin';

CREATE TABLE passkeys (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key text NOT NULL,
  algorithm integer NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  transports text NOT NULL DEFAULT '',
  backed_up boolean NOT NULL DEFAULT false,
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX passkeys_user_idx ON passkeys (user_id);

CREATE TABLE webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('register', 'login')),
  expires_at timestamptz NOT NULL
);
CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges (expires_at);

ALTER TABLE job_skips ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    EXECUTE format('REVOKE ALL ON TABLE public.job_skips, public.passkeys, public.webauthn_challenges FROM %I', r);
  END LOOP;
END $$;
`,
  },
];
