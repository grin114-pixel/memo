-- Memo 앱 Supabase 스키마
-- Supabase SQL Editor에서 실행하세요.

create table if not exists public.memo_notes (
  id         uuid        primary key default gen_random_uuid(),
  title      text        not null default '',
  content    text        not null default '',
  image_urls text[]      not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.memo_notes enable row level security;

-- anon 키로 읽기/쓰기/수정/삭제 허용 (개인용 앱)
create policy "anon can select" on public.memo_notes
  for select to anon using (true);

create policy "anon can insert" on public.memo_notes
  for insert to anon with check (true);

create policy "anon can update" on public.memo_notes
  for update to anon using (true) with check (true);

create policy "anon can delete" on public.memo_notes
  for delete to anon using (true);
