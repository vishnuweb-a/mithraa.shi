-- Phase 1C.1: persist Home ideas and trusted AI execution records.
-- Data-only foundation: no Groq calls, no production application/approval changes.
-- All client writes must use the narrowly scoped authenticated RPCs below.

create table public.idea_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  working_title text check (working_title is null or char_length(working_title) between 1 and 200),
  original_text text not null check (char_length(btrim(original_text)) between 1 and 12000),
  source_type text not null default 'one_line'
    check (source_type in ('one_line', 'voice_note', 'news_clipping', 'book')),
  language_code text not null default 'en'
    check (language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'),
  template_key text not null default 'theatrical_feature'
    check (template_key in (
      'theatrical_feature', 'vfx_feature', 'ott_series', 'documentary', 'micro_drama',
      'brand_ad', 'animation', 'social_reels', 'creator_video', 'side_gig'
    )),
  production_mode text not null default 'shot' check (production_mode in ('shot','hybrid','generated')),
  quality_tier text not null default 'standard' check (quality_tier in ('draft','standard','premium','master')),
  status text not null default 'draft' check (status in ('draft','parked','submitted','converted')),
  current_version integer not null default 1 check (current_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (status <> 'converted' or project_id is not null)
);
create index idea_drafts_owner_recent_idx on public.idea_drafts (owner_id, updated_at desc, id);
create index idea_drafts_project_idx on public.idea_drafts (project_id) where project_id is not null;

create table public.idea_versions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null,
  owner_id uuid not null,
  version_number integer not null check (version_number > 0),
  original_text text not null check (char_length(btrim(original_text)) between 1 and 12000),
  working_title text,
  change_note text check (change_note is null or char_length(change_note) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (idea_id, owner_id) references public.idea_drafts (id, owner_id) on delete cascade,
  unique (idea_id, version_number)
);
create index idea_versions_owner_idx on public.idea_versions (owner_id, idea_id, version_number desc);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null,
  owner_id uuid not null,
  idea_version integer not null check (idea_version > 0),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  status text not null default 'queued'
    check (status in ('queued','running','completed','partial','failed','cancelled')),
  model_mode text not null default 'auto'
    check (model_mode in ('auto','budget_first','quality_first','pinned','compare')),
  request_options jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_options) = 'object' and octet_length(request_options::text) <= 8192),
  estimated_credits numeric(14,3) check (estimated_credits is null or estimated_credits >= 0),
  cancel_requested_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (idea_id, owner_id) references public.idea_drafts (id, owner_id) on delete cascade,
  foreign key (idea_id, idea_version) references public.idea_versions (idea_id, version_number),
  unique (owner_id, idempotency_key)
);
create index agent_runs_owner_recent_idx on public.agent_runs (owner_id, created_at desc);
create index agent_runs_idea_recent_idx on public.agent_runs (idea_id, created_at desc);
create index agent_runs_pending_idx on public.agent_runs (status, created_at)
  where status in ('queued','running');
create unique index agent_runs_one_active_per_idea_idx on public.agent_runs (idea_id)
  where status in ('queued','running');

create table public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  agent_key text not null
    check (agent_key in ('idea_capture','market_scout','premise_scorer','ip_scout')),
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','skipped')),
  output jsonb check (output is null or (jsonb_typeof(output) = 'object' and octet_length(output::text) <= 131072)),
  provider text check (provider is null or char_length(provider) between 1 and 80),
  model text check (model is null or char_length(model) between 1 and 180),
  schema_version integer not null default 1 check (schema_version > 0),
  prompt_version text,
  attempts integer not null default 0 check (attempts between 0 and 10),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (run_id, agent_key)
);

create table public.research_sources (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.agent_steps (id) on delete cascade,
  source_url text not null check (char_length(source_url) <= 2048 and source_url ~* '^https://'),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  publisher text,
  claim_ref text,
  retrieved_at timestamptz not null default now(),
  source_type text not null default 'web' check (source_type in ('web','document','user_supplied')),
  verified boolean not null default false
);
create index research_sources_step_idx on public.research_sources (step_id);

create table public.agent_usage (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null unique references public.agent_steps (id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 80),
  model text not null check (char_length(model) between 1 and 180),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric(16,8) check (cost_usd is null or cost_usd >= 0),
  usage_source text not null check (usage_source in ('provider','estimated','unavailable')),
  recorded_at timestamptz not null default now()
);
create index agent_usage_provider_idx on public.agent_usage (provider, model, recorded_at desc);

-- RLS denies cross-user access. No direct client insert/update/delete grants:
-- draft writes and queueing must happen through the authenticated RPCs below.
alter table public.idea_drafts enable row level security;
alter table public.idea_versions enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.research_sources enable row level security;
alter table public.agent_usage enable row level security;

create policy "owner reads ideas" on public.idea_drafts
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads versions" on public.idea_versions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads agent runs" on public.agent_runs
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads agent steps" on public.agent_steps
  for select to authenticated using (
    exists (select 1 from public.agent_runs r where r.id = run_id and r.owner_id = (select auth.uid()))
  );
create policy "owner reads research sources" on public.research_sources
  for select to authenticated using (
    exists (select 1 from public.agent_steps s join public.agent_runs r on r.id = s.run_id
      where s.id = step_id and r.owner_id = (select auth.uid()))
  );
create policy "owner reads recorded usage" on public.agent_usage
  for select to authenticated using (
    exists (select 1 from public.agent_steps s join public.agent_runs r on r.id = s.run_id
      where s.id = step_id and r.owner_id = (select auth.uid()))
  );

revoke all on public.idea_drafts, public.idea_versions, public.agent_runs,
  public.agent_steps, public.research_sources, public.agent_usage from public, anon, authenticated;
grant select on public.idea_drafts, public.idea_versions, public.agent_runs,
  public.agent_steps, public.research_sources, public.agent_usage to authenticated;
-- Trusted worker only; never expose service-role credentials to client code.
-- Never grant UPDATE/DELETE on provenance snapshots to the worker.
grant select, insert on public.idea_versions to service_role;
grant select, insert, update on public.idea_drafts, public.agent_runs,
  public.agent_steps, public.research_sources, public.agent_usage to service_role;
-- Supabase defaults can grant DML to service_role; revoke direct mutation explicitly.
revoke update, delete on public.idea_versions from service_role;
revoke truncate on public.idea_versions, public.agent_runs, public.agent_steps,
  public.research_sources, public.agent_usage from service_role;

-- Protect historical input from even privileged accidental UPDATE. DELETE cascades
-- from an idea/user remain possible (no delete trigger); direct worker DELETE denied.
create trigger append_only before update on public.idea_versions
  for each row execute function private.forbid_change();
create trigger touch_updated_at before update on public.agent_runs
  for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.agent_steps
  for each row execute function private.touch_updated_at();

-- RPC 1: atomically create a versioned idea.
create function public.create_idea_draft(
  p_original_text text,
  p_working_title text default null,
  p_source_type text default 'one_line',
  p_language_code text default 'en',
  p_template_key text default 'theatrical_feature',
  p_production_mode text default 'shot',
  p_quality_tier text default 'standard'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean,false) then
    raise exception 'Sign in to save an idea' using errcode = '42501';
  end if;
  insert into public.idea_drafts
    (owner_id, original_text, working_title, source_type, language_code, template_key, production_mode, quality_tier)
  values
    (v_uid, p_original_text, p_working_title, p_source_type, p_language_code, p_template_key, p_production_mode, p_quality_tier)
  returning id into v_id;
  insert into public.idea_versions (idea_id, owner_id, version_number, original_text, working_title)
  values (v_id, v_uid, 1, p_original_text, p_working_title);
  return v_id;
end;
$$;

-- RPC 2: atomic revision; previous versions remain immutable.
create function public.revise_idea_draft(
  p_idea_id uuid,
  p_original_text text,
  p_working_title text default null,
  p_change_note text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_draft public.idea_drafts%rowtype;
  v_next integer;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean,false) then
    raise exception 'Sign in to revise an idea' using errcode = '42501';
  end if;
  select * into v_draft from public.idea_drafts
  where id = p_idea_id and owner_id = v_uid for update;
  if not found then
    raise exception 'Idea not found' using errcode = '42501';
  end if;
  if v_draft.status not in ('draft','parked') then
    raise exception 'This idea cannot be revised' using errcode = 'P0001';
  end if;
  -- Reruns are tied to immutable versions; a revision is allowed while an older version runs.
  v_next := v_draft.current_version + 1;
  update public.idea_drafts set original_text = p_original_text,
    working_title = coalesce(p_working_title, v_draft.working_title), current_version = v_next, status = 'draft',
    updated_at = now()
  where id = p_idea_id;
  insert into public.idea_versions
    (idea_id, owner_id, version_number, original_text, working_title, change_note)
  values (p_idea_id, v_uid, v_next, p_original_text,
    coalesce(p_working_title, v_draft.working_title), p_change_note);
  return v_next;
end;
$$;

-- RPC 3: park/unpark without disturbing versions or running jobs.
create function public.set_idea_parked(p_idea_id uuid, p_parked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean,false) then
    raise exception 'Sign in to manage ideas' using errcode = '42501';
  end if;
  update public.idea_drafts set status = case when p_parked then 'parked' else 'draft' end,
    updated_at = now()
  where id = p_idea_id and owner_id = v_uid and status in ('draft','parked');
  if not found then
    raise exception 'Idea not found or locked' using errcode = '42501';
  end if;
end;
$$;

-- RPC 4: queue one real job per idea, atomically and idempotently.
-- No client is permitted to report completed jobs, fake outputs or cost.
create function public.queue_idea_agent_run(
  p_idea_id uuid,
  p_idempotency_key text,
  p_model_mode text default 'auto',
  p_request_options jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_draft public.idea_drafts%rowtype;
  v_existing uuid;
  v_id uuid;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean,false) then
    raise exception 'Sign in to run agents' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  -- Serialize run creation per user; bounded, concurrency-safe free-tier usage.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 10311));
  select id into v_existing from public.agent_runs
    where owner_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if not exists (select 1 from public.agent_runs where id = v_existing and idea_id = p_idea_id) then
      raise exception 'Idempotency key already used for a different idea' using errcode = '22023';
    end if;
    return v_existing;
  end if;
  select * into v_draft from public.idea_drafts
    where id = p_idea_id and owner_id = v_uid for update;
  if not found or v_draft.status not in ('draft','parked') then
    raise exception 'Idea not found or unavailable' using errcode = '42501';
  end if;
  if exists (select 1 from public.agent_runs
    where idea_id = p_idea_id and status in ('queued','running')) then
    raise exception 'An agent run is already active for this idea' using errcode = '23505';
  end if;
  if (select count(*) from public.agent_runs where owner_id = v_uid
      and created_at >= now() - interval '24 hours') >= 10 then
    raise exception 'Daily agent run limit reached' using errcode = 'P0001';
  end if;
  insert into public.agent_runs
    (idea_id, owner_id, idea_version, idempotency_key, model_mode, request_options)
  values (p_idea_id, v_uid, v_draft.current_version, p_idempotency_key, p_model_mode, p_request_options)
  returning id into v_id;
  insert into public.agent_steps (run_id, agent_key) values
    (v_id,'idea_capture'), (v_id,'market_scout'),
    (v_id,'premise_scorer'), (v_id,'ip_scout');
  return v_id;
end;
$$;

-- RPC 5: cancellation is only a request; server worker owns the lifecycle.
create function public.request_idea_run_cancel(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean,false) then
    raise exception 'Sign in to cancel runs' using errcode = '42501';
  end if;
  update public.agent_runs set cancel_requested_at = coalesce(cancel_requested_at, now()),
    updated_at = now()
  where id = p_run_id and owner_id = v_uid and status in ('queued','running');
  if not found then
    raise exception 'Run not found or already finished' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.create_idea_draft(text,text,text,text,text,text,text),
  public.revise_idea_draft(uuid,text,text,text),
  public.set_idea_parked(uuid,boolean),
  public.queue_idea_agent_run(uuid,text,text,jsonb),
  public.request_idea_run_cancel(uuid)
from public, anon;
grant execute on function public.create_idea_draft(text,text,text,text,text,text,text),
  public.revise_idea_draft(uuid,text,text,text),
  public.set_idea_parked(uuid,boolean),
  public.queue_idea_agent_run(uuid,text,text,jsonb),
  public.request_idea_run_cancel(uuid)
to authenticated;
