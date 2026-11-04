-- 게스트 플레이 기록. 브라우저에서 만든 랜덤 ID만 받는다: IP·기기 정보·개인정보는 저장하지 않는다.
create table public.jamsildo_guests (
  id uuid primary key,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  play_seconds bigint not null default 0,
  sessions integer not null default 0,
  stage integer not null default 1,
  max_stage integer not null default 1
);
create index jamsildo_guests_last_seen on public.jamsildo_guests(last_seen desc);
create table public.jamsildo_guest_sessions (
  guest_id uuid not null references public.jamsildo_guests on delete cascade,
  id uuid not null,
  started_at timestamptz not null default now(),
  seconds integer not null default 0,
  primary key (guest_id, id)
);
alter table public.jamsildo_guests enable row level security;
alter table public.jamsildo_guest_sessions enable row level security;
revoke all on public.jamsildo_guests, public.jamsildo_guest_sessions from anon, authenticated;

-- 로그인 없이 불리는 유일한 쓰기. Edge Function(service_role)만 부를 수 있고, 그쪽에서 IP별 횟수를 제한한다.
-- 시간은 세션별 누적값으로 받아 중복을 막고, 세션이 시작된 뒤 실제로 지난 시간을 넘지 못하게 자른다.
create function public.jamsildo_guest_ping(p_guest uuid, p_session uuid, p_seconds integer, p_stage integer)
returns void language plpgsql security definer set search_path = '' as $$
declare previous integer; counted integer; started timestamptz; opened integer;
begin
  if p_stage is null or p_stage < 1 or p_stage > 20 then raise exception 'invalid_guest'; end if;
  insert into public.jamsildo_guests(id, stage, max_stage) values(p_guest, p_stage, p_stage) on conflict do nothing;
  perform 1 from public.jamsildo_guests where id = p_guest for update;
  insert into public.jamsildo_guest_sessions(guest_id, id) values(p_guest, p_session) on conflict do nothing;
  get diagnostics opened = row_count;
  select seconds, started_at into previous, started from public.jamsildo_guest_sessions where guest_id = p_guest and id = p_session for update;
  counted := greatest(previous, least(greatest(0, p_seconds), floor(extract(epoch from now() - started))::integer + 30));
  update public.jamsildo_guest_sessions set seconds = counted where guest_id = p_guest and id = p_session;
  update public.jamsildo_guests set play_seconds = play_seconds + counted - previous, sessions = sessions + opened,
    stage = p_stage, max_stage = greatest(max_stage, p_stage), last_seen = now() where id = p_guest;
end $$;
revoke all on function public.jamsildo_guest_ping(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.jamsildo_guest_ping(uuid, uuid, integer, integer) to service_role;

create function public.jamsildo_admin_guests(p_page integer) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((auth.jwt()->'app_metadata'->>'jamsildo_admin')::boolean, false) = false then raise exception 'admin_required'; end if;
  return (select jsonb_build_object(
    'total', count(*),
    'today', count(*) filter(where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'active_today', count(*) filter(where last_seen >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'online', count(*) filter(where last_seen > now() - interval '60 seconds'),
    'play_seconds', coalesce(sum(play_seconds), 0),
    'stages', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (select stage, count(*) as players from public.jamsildo_guests group by stage order by stage) s),
    'guests', (select coalesce(jsonb_agg(g), '[]'::jsonb) from (
      select id, created_at, last_seen, play_seconds, sessions, stage, max_stage from public.jamsildo_guests
      order by last_seen desc, id offset greatest(0, p_page) * 25 limit 25
    ) g)
  ) from public.jamsildo_guests);
end $$;
revoke all on function public.jamsildo_admin_guests(integer) from public, anon;
grant execute on function public.jamsildo_admin_guests(integer) to authenticated;
