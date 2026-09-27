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
];
