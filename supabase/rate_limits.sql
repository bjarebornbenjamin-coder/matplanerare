-- Kör i Supabase → SQL Editor (en gång). Hastighetsbegränsning för serverns AI-adresser.
-- Räknaren ligger i databasen så att den gäller över alla Vercel-instanser; minnet i en
-- enskild serverfunktion nollställs hela tiden och räcker inte som skydd.

create table if not exists public.rate_limits (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (user_id, bucket, window_start)
);

-- Inga policys: tabellen går bara att nå via funktionen nedan.
alter table public.rate_limits enable row level security;

-- Räknar ett anrop för den inloggade användaren och svarar 0 om det är tillåtet, annars hur
-- många sekunder det är kvar tills nästa försök. Anroparen kan bara påverka sina egna rader.
create or replace function public.hit_rate_limit(p_bucket text, p_per_minute integer, p_per_day integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid        := auth.uid();
  m_start timestamptz := date_trunc('minute', now());
  d_start timestamptz := date_trunc('day', now());
  m_hits  integer;
  d_hits  integer;
begin
  if uid is null then
    return 60;
  end if;
  if p_bucket !~ '^[a-z]{1,20}$' then
    raise exception 'ogiltigt namn';
  end if;

  insert into rate_limits as r (user_id, bucket, window_start, hits)
  values (uid, p_bucket || ':m', m_start, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into m_hits;

  insert into rate_limits as r (user_id, bucket, window_start, hits)
  values (uid, p_bucket || ':d', d_start, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into d_hits;

  delete from rate_limits where user_id = uid and window_start < now() - interval '2 days';

  if d_hits > p_per_day then
    return greatest(1, ceil(extract(epoch from (d_start + interval '1 day' - now()))))::integer;
  end if;
  if m_hits > p_per_minute then
    return greatest(1, ceil(extract(epoch from (m_start + interval '1 minute' - now()))))::integer;
  end if;
  return 0;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.hit_rate_limit(text, integer, integer) to authenticated;
