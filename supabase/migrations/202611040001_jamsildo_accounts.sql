create table public.jamsildo_players (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  is_admin boolean not null default false,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  play_seconds bigint not null default 0,
  stage integer not null default 1,
  max_stage integer not null default 1
);
create table public.jamsildo_saves (
  user_id uuid primary key references public.jamsildo_players on delete cascade,
  checkpoint jsonb,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);
create table public.jamsildo_sessions (
  user_id uuid not null references public.jamsildo_players on delete cascade,
  id uuid not null,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  seconds integer not null default 0,
  primary key (user_id, id)
);
create index jamsildo_sessions_last_seen on public.jamsildo_sessions(last_seen);
create table public.jamsildo_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
create table public.jamsildo_admin_log (
  id bigint generated always as identity primary key,
  actor uuid not null references public.jamsildo_players,
  target uuid not null references public.jamsildo_players,
  action text not null,
  created_at timestamptz not null default now()
);
alter table public.jamsildo_players enable row level security;
alter table public.jamsildo_saves enable row level security;
alter table public.jamsildo_sessions enable row level security;
alter table public.jamsildo_rate_limits enable row level security;
alter table public.jamsildo_admin_log enable row level security;
revoke all on public.jamsildo_players, public.jamsildo_saves, public.jamsildo_sessions, public.jamsildo_rate_limits, public.jamsildo_admin_log from anon, authenticated;
grant select on public.jamsildo_players, public.jamsildo_saves to authenticated;
create policy own_player on public.jamsildo_players for select to authenticated using (id = (select auth.uid()));
create policy own_save on public.jamsildo_saves for select to authenticated using (user_id = (select auth.uid()));

create function public.jamsildo_create_player() returns trigger language plpgsql security definer set search_path = '' as $$
declare username text := split_part(new.email, '@', 1);
begin
  if new.email not like '%@players.jamsildo.invalid' then return new; end if;
  if username = 'jp0405' and coalesce((new.raw_app_meta_data->>'jamsildo_admin')::boolean, false) = false then raise exception 'reserved username'; end if;
  insert into public.jamsildo_players(id, username, is_admin) values(new.id, username, coalesce((new.raw_app_meta_data->>'jamsildo_admin')::boolean, false));
  insert into public.jamsildo_saves(user_id) values(new.id);
  return new;
end $$;
create trigger jamsildo_new_user after insert on auth.users for each row execute function public.jamsildo_create_player();
revoke all on function public.jamsildo_create_player() from public, anon, authenticated;

create function public.jamsildo_rate_limit(p_key text, p_limit integer) returns boolean language plpgsql security definer set search_path = '' as $$
declare count integer;
begin
  delete from public.jamsildo_rate_limits where window_start < now() - interval '1 day';
  insert into public.jamsildo_rate_limits as r(key) values(p_key)
    on conflict(key) do update set
      attempts = case when r.window_start < now() - interval '10 minutes' then 1 else r.attempts + 1 end,
      window_start = case when r.window_start < now() - interval '10 minutes' then now() else r.window_start end
    returning attempts into count;
  return count <= p_limit;
end $$;
revoke all on function public.jamsildo_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.jamsildo_rate_limit(text, integer) to service_role;

create function public.jamsildo_sync(p_revision integer, p_checkpoint jsonb, p_session uuid, p_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); previous integer; counted integer; started timestamptz; current_revision integer; saved_at timestamptz;
begin
  perform 1 from public.jamsildo_players where id = uid and not blocked for update;
  if not found then raise exception 'account_blocked'; end if;
  select revision, updated_at into current_revision, saved_at from public.jamsildo_saves where user_id = uid for update;
  if p_checkpoint is not null then
    if p_revision <> current_revision then raise exception 'save_conflict'; end if;
    if pg_column_size(p_checkpoint) > 45000 or coalesce(p_checkpoint->>'version','') not in ('1','2') or
       coalesce(p_checkpoint->>'stage','') !~ '^([1-9]|1[0-9]|20)$' then raise exception 'invalid_checkpoint'; end if;
    current_revision := current_revision + 1; saved_at := now();
    update public.jamsildo_saves set checkpoint = p_checkpoint, revision = current_revision, updated_at = saved_at where user_id = uid;
    update public.jamsildo_players set stage = (p_checkpoint->>'stage')::integer, max_stage = greatest(max_stage, (p_checkpoint->>'stage')::integer) where id = uid;
  end if;
  insert into public.jamsildo_sessions(user_id,id) values(uid,p_session) on conflict do nothing;
  select seconds, started_at into previous, started from public.jamsildo_sessions where user_id = uid and id = p_session for update;
  counted := greatest(previous, least(greatest(0,p_seconds), floor(extract(epoch from now() - started))::integer + 30));
  update public.jamsildo_sessions set seconds = counted, last_seen = now() where user_id = uid and id = p_session;
  update public.jamsildo_players set play_seconds = play_seconds + counted - previous, last_seen = now() where id = uid;
  return jsonb_build_object('revision', case when p_checkpoint is null then p_revision else current_revision end, 'updated_at', saved_at);
end $$;
revoke all on function public.jamsildo_sync(integer,jsonb,uuid,integer) from public, anon;
grant execute on function public.jamsildo_sync(integer,jsonb,uuid,integer) to authenticated;

create function public.jamsildo_admin_overview() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((auth.jwt()->'app_metadata'->>'jamsildo_admin')::boolean,false) = false then raise exception 'admin_required'; end if;
  return (select jsonb_build_object(
    'players',count(*), 'today',count(*) filter(where created_at >= date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'online',count(*) filter(where last_seen > now()-interval '60 seconds'),
    'active_today',count(*) filter(where last_seen >= date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'play_seconds',coalesce(sum(play_seconds),0), 'blocked',count(*) filter(where blocked),
    'stages',(select coalesce(jsonb_agg(s),'[]'::jsonb) from (select stage,count(*) as players from public.jamsildo_players where not is_admin group by stage order by stage) s)
  ) from public.jamsildo_players where not is_admin);
end $$;
revoke all on function public.jamsildo_admin_overview() from public, anon;
grant execute on function public.jamsildo_admin_overview() to authenticated;

create function public.jamsildo_admin_block(p_target uuid, p_blocked boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((auth.jwt()->'app_metadata'->>'jamsildo_admin')::boolean,false) = false then raise exception 'admin_required'; end if;
  update public.jamsildo_players set blocked = p_blocked where id = p_target and not is_admin;
  if not found then raise exception 'invalid_target'; end if;
  insert into public.jamsildo_admin_log(actor,target,action) values(auth.uid(),p_target,case when p_blocked then 'block' else 'unblock' end);
end $$;
revoke all on function public.jamsildo_admin_block(uuid,boolean) from public, anon;
grant execute on function public.jamsildo_admin_block(uuid,boolean) to authenticated;
