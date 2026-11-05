-- 플레이 분석: 한 판(런)을 한 행으로 남긴다. 계정이면 player_id, 게스트면 guest_id.
create table public.jamsildo_runs (
  id uuid primary key,
  player_id uuid references public.jamsildo_players on delete set null,
  guest_id uuid,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seconds integer not null default 0,
  stage integer not null default 1,
  max_stage integer not null default 1,
  deaths integer not null default 0,
  deaths_by_stage jsonb not null default '{}',
  status text not null default 'playing' check (status in ('playing','down','cleared')),
  spirits jsonb not null default '[]',
  artifacts jsonb not null default '[]',
  augments jsonb not null default '[]',
  weapon text not null default ''
);
create index jamsildo_runs_updated on public.jamsildo_runs(updated_at desc);
alter table public.jamsildo_runs enable row level security;
revoke all on public.jamsildo_runs from anon, authenticated;

-- Edge Function(service_role)만 부른다. 다른 사람의 런은 덮어쓸 수 없고, 시간은 실제로 지난 시간을 넘지 못한다.
create function public.jamsildo_run_ping(p_run uuid, p_player uuid, p_guest uuid, p_stage integer, p_seconds integer, p_deaths jsonb, p_status text, p_spirits jsonb, p_artifacts jsonb, p_augments jsonb, p_weapon text)
returns void language plpgsql security definer set search_path = '' as $$
declare total integer := coalesce((select sum(value::integer) from jsonb_each_text(p_deaths)), 0);
begin
  insert into public.jamsildo_runs as r(id, player_id, guest_id, seconds, stage, max_stage, deaths, deaths_by_stage, status, spirits, artifacts, augments, weapon)
  values(p_run, p_player, p_guest, least(greatest(0, p_seconds), 30), p_stage, p_stage, total, p_deaths, p_status, p_spirits, p_artifacts, p_augments, p_weapon)
  on conflict(id) do update set
    seconds = greatest(r.seconds, least(greatest(0, p_seconds), floor(extract(epoch from now() - r.started_at))::integer + 30)),
    stage = excluded.stage, max_stage = greatest(r.max_stage, excluded.stage), deaths = excluded.deaths, deaths_by_stage = excluded.deaths_by_stage,
    status = excluded.status, spirits = excluded.spirits, artifacts = excluded.artifacts, augments = excluded.augments, weapon = excluded.weapon, updated_at = now()
  where r.player_id is not distinct from excluded.player_id and r.guest_id is not distinct from excluded.guest_id;
end $$;
revoke all on function public.jamsildo_run_ping(uuid, uuid, uuid, integer, integer, jsonb, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.jamsildo_run_ping(uuid, uuid, uuid, integer, integer, jsonb, text, jsonb, jsonb, jsonb, text) to service_role;

-- 분석용 행: 관리자 제외. 10분 넘게 소식이 없는 진행 중 런은 '이탈'로 본다.
create view public.jamsildo_run_rows with (security_invoker = true) as
  select r.*, coalesce(p.username, '게스트 ' || left(r.guest_id::text, 8)) as who,
    case when r.status = 'cleared' then 'cleared' when r.updated_at > now() - interval '10 minutes' then 'playing' when r.status = 'down' then 'down' else 'left' end as state
  from public.jamsildo_runs r left join public.jamsildo_players p on p.id = r.player_id
  where not coalesce(p.is_admin, false);
revoke all on public.jamsildo_run_rows from anon, authenticated;

create function public.jamsildo_admin_runs(p_page integer) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((auth.jwt()->'app_metadata'->>'jamsildo_admin')::boolean, false) = false then raise exception 'admin_required'; end if;
  return jsonb_build_object(
    'summary', (select jsonb_build_object('runs', count(*), 'people', count(distinct who), 'seconds', coalesce(sum(seconds), 0), 'deaths', coalesce(sum(deaths), 0), 'cleared', count(*) filter(where state = 'cleared'), 'left', count(*) filter(where state in ('left', 'down'))) from public.jamsildo_run_rows),
    'stages', (select jsonb_agg(s order by s.stage) from (
      select n as stage, count(*) filter(where r.max_stage >= n) as reached,
        coalesce(sum((r.deaths_by_stage->>n::text)::integer), 0) as deaths,
        count(*) filter(where r.stage = n and r.state in ('left', 'down')) as stopped
      from generate_series(1, 20) n left join public.jamsildo_run_rows r on true group by n) s),
    'builds', (select coalesce(jsonb_agg(b order by b.kind, b.runs desc), '[]'::jsonb) from (
      select kind, id, count(*) as runs, round(avg(max_stage), 1) as avg_stage, round(avg(deaths), 1) as avg_deaths from (
        select 'artifact' as kind, value as id, max_stage, deaths from public.jamsildo_run_rows, jsonb_array_elements_text(artifacts)
        union all select 'augment', value, max_stage, deaths from public.jamsildo_run_rows, jsonb_array_elements_text(augments)
        union all select 'spirit', split_part(value, ':', 1), max_stage, deaths from public.jamsildo_run_rows, jsonb_array_elements_text(spirits)
        union all select 'weapon', weapon, max_stage, deaths from public.jamsildo_run_rows where weapon <> ''
      ) x group by kind, id) b),
    'people', (select coalesce(jsonb_agg(u), '[]'::jsonb) from (
      select who, count(*) as runs, sum(deaths) as deaths, sum(seconds) as seconds, max(max_stage) as best, (array_agg(stage order by updated_at desc))[1] as last_stage, max(updated_at) as last_seen
      from public.jamsildo_run_rows group by who order by max(updated_at) desc offset greatest(0, p_page) * 25 limit 25) u),
    'recent', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select who, started_at, seconds, stage, max_stage, deaths, state, spirits, artifacts, augments, weapon from public.jamsildo_run_rows order by updated_at desc limit 25) x)
  );
end $$;
revoke all on function public.jamsildo_admin_runs(integer) from public, anon;
grant execute on function public.jamsildo_admin_runs(integer) to authenticated;

-- CSV 내보내기: 최근 런 5000개
create function public.jamsildo_admin_runs_export() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((auth.jwt()->'app_metadata'->>'jamsildo_admin')::boolean, false) = false then raise exception 'admin_required'; end if;
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select who, started_at, updated_at, seconds, stage, max_stage, deaths, deaths_by_stage, state, spirits, artifacts, augments, weapon from public.jamsildo_run_rows order by updated_at desc limit 5000) x);
end $$;
revoke all on function public.jamsildo_admin_runs_export() from public, anon;
grant execute on function public.jamsildo_admin_runs_export() to authenticated;
