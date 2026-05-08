create table if not exists public.exam_settings (
  id boolean primary key default true check (id = true),
  duration_minutes integer not null default 90 check (duration_minutes between 15 and 300),
  is_paused boolean not null default false,
  paused_at timestamptz null,
  updated_at timestamptz not null default now()
);

insert into public.exam_settings (id, duration_minutes)
values (true, 90)
on conflict (id) do nothing;

create table if not exists public.exam_sessions (
  user_id uuid primary key references public.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  duration_minutes integer not null check (duration_minutes between 15 and 300),
  remaining_seconds integer not null default 5400,
  is_paused boolean not null default false,
  paused_total_seconds integer not null default 0,
  pause_started_at timestamptz null,
  ended_at timestamptz null,
  ended_reason text null check (ended_reason in ('submitted', 'timeout')),
  updated_at timestamptz not null default now()
);

alter table public.exam_settings
  add column if not exists is_paused boolean not null default false;
alter table public.exam_settings
  add column if not exists paused_at timestamptz null;

alter table public.exam_sessions
  add column if not exists paused_total_seconds integer not null default 0;
alter table public.exam_sessions
  add column if not exists pause_started_at timestamptz null;
alter table public.exam_sessions
  add column if not exists remaining_seconds integer not null default 5400;
alter table public.exam_sessions
  add column if not exists is_paused boolean not null default false;

create index if not exists exam_sessions_started_at_idx on public.exam_sessions (started_at);

create table if not exists public.exam_control (
  id boolean primary key default true check (id = true),
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED', 'SCHEDULED', 'RUNNING', 'PAUSED', 'ENDED')),
  start_time timestamptz null,
  end_time timestamptz null,
  paused_at timestamptz null,
  paused_remaining_seconds integer null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.exam_control (id, status)
values (true, 'NOT_STARTED')
on conflict (id) do nothing;

alter table public.exam_control
  add column if not exists paused_remaining_seconds integer null;
alter table public.exam_control
  add column if not exists updated_by text null;
