create table if not exists flags (
  key text primary key,
  name text not null,
  description text not null default '',
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists flag_environment_configs (
  flag_key text not null references flags(key) on delete cascade,
  environment text not null check (environment in ('dev', 'staging', 'prod')),
  config jsonb not null,
  version integer not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (flag_key, environment)
);

create table if not exists flag_environment_audit (
  id bigserial primary key,
  flag_key text not null references flags(key) on delete cascade,
  environment text not null check (environment in ('dev', 'staging', 'prod')),
  version integer not null,
  actor text not null,
  action text not null check (action in ('create','update')),
  reason text not null,
  before_config jsonb,
  after_config jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_flag_env_audit_flag_key_created_at on flag_environment_audit(flag_key, created_at desc);
