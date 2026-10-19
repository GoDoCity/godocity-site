-- supabase/vibe_posts.sql
-- Vibe Board — community "positive vibe" posts shown at /[city]/vibe/.
--
-- Run once in the Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Trust model:
--   • Submissions go only through functions/api/vibe-submit.js (service role),
--     so every new row lands as status = 'pending'.
--   • Approval happens only through functions/api/vibe-posts-admin.js
--     (service role + ADMIN_TOKEN).
--   • The public anon key can read APPROVED rows, and only the public columns —
--     email, last_name and newsletter_opt_in are never granted to anon.
--   • "❤️ Send Vibe" goes through send_vibe(), which can only bump the counter
--     on an approved post.

create table if not exists public.vibe_posts (
  id                uuid        primary key default gen_random_uuid(),
  city              text        not null,
  first_name        text        not null check (char_length(first_name) between 1 and 60),
  last_name         text        not null check (char_length(last_name)  between 1 and 60),
  email             text        not null check (char_length(email) <= 254),
  category          text        not null,
  message           text        not null check (char_length(message) between 10 and 600),
  newsletter_opt_in boolean     not null default false,
  status            text        not null default 'pending'
                                check (status in ('pending', 'approved', 'rejected')),
  vibe_count        integer     not null default 0 check (vibe_count >= 0),
  created_at        timestamptz not null default now(),
  reviewed_at       timestamptz
);

-- Public display name: "Jane D." — the full last name stays private.
alter table public.vibe_posts
  add column if not exists last_initial text
  generated always as (upper(left(last_name, 1))) stored;

create index if not exists vibe_posts_feed_idx
  on public.vibe_posts (city, status, created_at desc);

alter table public.vibe_posts enable row level security;

-- Supabase grants anon/authenticated full table privileges by default. Strip
-- them, then hand back SELECT on the public columns only.
revoke all on public.vibe_posts from anon, authenticated;
grant select (id, city, first_name, last_initial, category, message, vibe_count, created_at)
  on public.vibe_posts to anon, authenticated;

drop policy if exists "Public can read approved vibe posts" on public.vibe_posts;
create policy "Public can read approved vibe posts"
  on public.vibe_posts
  for select
  to anon, authenticated
  using (status = 'approved');

-- No insert/update/delete policies: only the service role can write rows.

-- ❤️ Send Vibe — increments the counter on an approved post and returns the
-- new total. Runs as the table owner so anon needs no UPDATE privilege.
create or replace function public.send_vibe(p_post_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.vibe_posts
     set vibe_count = vibe_count + 1
   where id = p_post_id
     and status = 'approved'
  returning vibe_count;
$$;

revoke all on function public.send_vibe(uuid) from public;
grant execute on function public.send_vibe(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
