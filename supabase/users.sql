create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'student')),
  is_active boolean not null default true,
  question_pdf_url text null,
  created_at timestamptz not null default now()
);

alter table public.users
  add column if not exists is_active boolean not null default true;

alter table public.users
  add column if not exists question_pdf_url text null;

create index if not exists users_username_idx on public.users (username);
