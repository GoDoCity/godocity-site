-- supabase/vibe_check_adjustments.sql
-- Admin vote offsets for Vibe Check polls.
--
-- Real votes in vibe_check_votes are never edited. Each row here is a logged,
-- reversible +/- offset for one poll option; SidebarPoll adds the summed
-- offsets to the real counts (clamped at 0) when it renders results.
--
-- Run once in the Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Writes go only through functions/api/vibe-admin.js with the service-role
-- key (which bypasses RLS). The public anon key can read offsets, nothing else.

create table if not exists public.vibe_check_adjustments (
  id           bigint generated always as identity primary key,
  poll_id      text        not null,  -- matches vibe_check_votes.question_text
  option_label text        not null,  -- matches vibe_check_votes.option_selected
  delta        integer     not null check (delta <> 0),
  note         text,
  created_at   timestamptz not null default now()
);

-- An earlier hand-made version of this table named the column option_name,
-- which makes SidebarPoll's select 400. Rename it in place if present.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'vibe_check_adjustments'
               and column_name = 'option_name')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'vibe_check_adjustments'
               and column_name = 'option_label') then
    alter table public.vibe_check_adjustments rename column option_name to option_label;
  end if;
end $$;

-- Make PostgREST pick up the renamed column immediately.
notify pgrst, 'reload schema';

create index if not exists vibe_check_adjustments_poll_idx
  on public.vibe_check_adjustments (poll_id);

alter table public.vibe_check_adjustments enable row level security;

drop policy if exists "Public can read vote adjustments" on public.vibe_check_adjustments;
create policy "Public can read vote adjustments"
  on public.vibe_check_adjustments
  for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policies: only the service role can write.
