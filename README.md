# Ubuntu Web Lab Simulator

Terminal-first simulator untuk praktikum Sistem Operasi (Linux command, Bash, C) + fitur ujian (student/admin) dengan Supabase.

## Fitur utama
- Terminal simulator Ubuntu (frontend only)
- Editor `gedit/nano` via modal CodeMirror
- Filesystem simulasi per-user (localStorage)
- Role login sederhana: `student` dan `admin`
- Submit ujian oleh student
- Dashboard admin untuk review submission, beri nilai, feedback

## Environment Variables (`.env.local`)
```bash
APP_USERS='[
  {"username":"admin","password":"admin123","name":"Admin","role":"admin"},
  {"username":"praktikan1","password":"praktikum123","name":"Praktikan 1","role":"student"},
  {"username":"praktikan2","password":"praktikum123","name":"Praktikan 2","role":"student"}
]'

AUTH_SECRET="ubah-dengan-random-string"
SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="xxxxx"
```

## SQL Supabase
Jalankan di SQL Editor Supabase:
```sql
create extension if not exists pgcrypto;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  student_username text not null,
  student_name text not null,
  exam_title text default 'Ujian Sistem Operasi',
  files_json jsonb not null,
  terminal_history jsonb,
  status text default 'submitted',
  score integer,
  feedback text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_submissions_updated_at on public.submissions;
create trigger trg_submissions_updated_at
before update on public.submissions
for each row
execute function public.set_updated_at();
```

## Install & Run
```bash
npm install
npm run dev
```


## Alur test student
1. Login: `praktikan1 / praktikum123`
2. Command:
   - `mkdir latihan-c`
   - `cd latihan-c`
   - `gedit angka.c` (isi kode, Save)
   - `ls`
   - `gcc angka.c -o angka`
   - `./angka`
3. Klik `Submit Ujian` di header terminal.

## Alur test admin
1. Login: `admin / admin123`
2. Buka `/admin`.
3. Klik `Lihat Detail`.
4. Cek file dan terminal history.
5. Isi score + feedback, klik `Save Nilai`.

## Deploy Vercel
1. Push ke GitHub.
2. Import repo ke Vercel.
3. Isi semua env variable (`APP_USERS`, `AUTH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
4. Deploy.
