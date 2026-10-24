-- Phase 1A: Project Brain foundation.
--
-- Projects, membership with project-scoped roles, the nine gated stages, a configurable
-- multi-signer gate policy, gate checklists, append-only gate decisions, trigger-written
-- audit events and human-authored Brain records.
--
-- Security model (see docs/PROJECT_BRAIN_DATABASE_ARCHITECTURE.md):
--   * every table has RLS; access is scoped by project membership
--   * clients get column-level grants only; trusted columns (signer, actor, timestamps) are
--     set by defaults or triggers, never by the client
--   * stage progression and audit rows are written only by SECURITY DEFINER triggers
--   * a gate decision needs a signed-in person (auth.uid()); service-role / agent code
--     cannot sign, because triggers run even when RLS is bypassed

-- ---------------------------------------------------------------------------
-- Schemas and types
-- ---------------------------------------------------------------------------

-- Not exposed through the Data API. Holds RLS helpers, trigger functions and templates.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated; -- RLS policies call private helpers as the invoker

-- Matches RoleId in lib/data.ts.
create type public.project_role as enum
  ('producer', 'director', 'writer', 'investor', 'pm', 'hod', 'crew', 'client');
create type public.stage_status as enum ('locked', 'active', 'passed');
create type public.gate_decision as enum ('approve', 'reject');
create type public.actor_kind as enum ('human', 'agent', 'system');

-- ---------------------------------------------------------------------------
-- Reference data: the nine stages (StageId in lib/data.ts)
-- ---------------------------------------------------------------------------

create table public.stages (
  id text primary key check (id ~ '^[a-z]+$'),
  position smallint not null unique check (position between 1 and 9),
  name text not null,
  gate_name text not null
);
comment on table public.stages is 'The nine production stages. Reference data, same for every project.';

insert into public.stages (id, position, name, gate_name) values
  ('ideate',     1, 'Ideate',             'Idea Greenlight'),
  ('develop',    2, 'Develop',            'Story Approval'),
  ('write',      3, 'Write',              'Script Lock'),
  ('protect',    4, 'Lock & Protect',     'Protection Complete'),
  ('finance',    5, 'Package & Finance',  'Financing Close'),
  ('prep',       6, 'Pre-production',     'Shoot Ready'),
  ('production', 7, 'Production',         'Picture Wrap'),
  ('post',       8, 'Post & Localise',    'Final Delivery'),
  ('release',    9, 'Release & Monetise', 'Release');

-- Default gate policy copied into each new project. Derived from the blueprint's gate rules
-- (docs/BUSSINESS_FLOW.md §5) and lib/data.ts; each row must be met. signers_required null = every member holding
-- one of the roles (and at least one such member must exist).
create table private.default_gate_requirements (
  stage_id text not null references public.stages (id),
  roles public.project_role[] not null check (cardinality(roles) > 0),
  signers_required smallint check (signers_required > 0)
);

insert into private.default_gate_requirements (stage_id, roles, signers_required) values
  ('ideate',     '{producer,writer}', 1),  -- "The creator or producer moves ideas into development"
  ('develop',    '{writer}',   1),
  ('develop',    '{director}', 1),
  ('develop',    '{producer}', 1),
  ('write',      '{director}', 1),
  ('write',      '{producer}', 1),
  ('protect',    '{writer}',   1),
  ('protect',    '{producer}', 1),         -- prototype only; blueprint says "all credit parties sign" (open question)
  ('finance',    '{producer}', 1),
  ('finance',    '{investor}', null),      -- "The producer and investors sign"
  ('prep',       '{producer}', 1),
  ('prep',       '{director}', 1),
  ('prep',       '{hod}',      null),      -- "The producer, director and every HOD sign"
  ('production', '{director}', 1),
  ('post',       '{director}', 1),         -- blueprint: director final cut + buyer acceptance
  ('post',       '{client}',   1),
  ('release',    '{producer}', 1);

create table private.default_gate_items (
  stage_id text not null references public.stages (id),
  position smallint not null,
  label text not null,
  primary key (stage_id, position)
);

insert into private.default_gate_items (stage_id, position, label) values
  ('ideate', 1, 'Every shortlisted idea scored with reasons'),
  ('ideate', 2, 'Source rights checked for adaptations'),
  ('ideate', 3, 'Producer greenlight recorded'),
  ('develop', 1, 'Treatment approved by writer and director'),
  ('develop', 2, 'Scene order locked'),
  ('develop', 3, 'Scale signed off by producer'),
  ('write', 1, 'All notes resolved'),
  ('write', 2, 'Page count in range (104–118)'),
  ('write', 3, 'Lock approved by director and producer'),
  ('protect', 1, 'Registered with SWA'),
  ('protect', 2, 'Credits signed by all parties'),
  ('protect', 3, 'NDAs in place for everyone with access'),
  ('finance', 1, 'Budget approved and baselined'),
  ('finance', 2, 'Funding committed to 100%'),
  ('finance', 3, 'Investor agreements signed'),
  ('prep', 1, 'Every scene cast'),
  ('prep', 2, 'Every scene located'),
  ('prep', 3, 'Schedule signed by all HODs'),
  ('prep', 4, 'Budget within locked baseline'),
  ('prep', 5, 'Boards and look approved'),
  ('production', 1, 'All scheduled scenes complete'),
  ('production', 2, 'All shots approved'),
  ('production', 3, 'Footage backed up in two places'),
  ('post', 1, 'Final cut locked'),
  ('post', 2, 'CBFC certificate issued'),
  ('post', 3, 'Deliverables accepted by buyer'),
  ('release', 1, 'Release approved'),
  ('release', 2, 'Rights clear in every live territory'),
  ('release', 3, 'Campaign assets approved');

-- ---------------------------------------------------------------------------
-- People and projects
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Public profile for each auth user. Holds no authorization data.';

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  code text check (code ~ '^[A-Z0-9-]{2,16}$'),
  logline text check (char_length(logline) <= 1000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.projects is 'One film. Created only through public.create_project().';

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.project_role not null,
  department text check (char_length(department) between 1 and 60), -- e.g. 'Costume' for a HOD
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (project_id, user_id, role, department)
);
comment on table public.project_members is
  'A person may hold several roles on one project (one row each). Only producers add or remove members.';
create index project_members_user_idx on public.project_members (user_id, project_id);

-- ---------------------------------------------------------------------------
-- Stages, gates and decisions
-- ---------------------------------------------------------------------------

create table public.project_stages (
  project_id uuid not null references public.projects (id) on delete cascade,
  stage_id text not null references public.stages (id),
  status public.stage_status not null default 'locked',
  activated_at timestamptz,
  passed_at timestamptz,
  primary key (project_id, stage_id),
  check ((status = 'passed') = (passed_at is not null))
);
create unique index project_stages_one_active on public.project_stages (project_id) where status = 'active';
create index project_stages_stage_idx on public.project_stages (stage_id);

create table public.gate_requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  stage_id text not null,
  roles public.project_role[] not null check (cardinality(roles) > 0),
  signers_required smallint check (signers_required > 0),
  created_at timestamptz not null default now(),
  foreign key (project_id, stage_id) references public.project_stages (project_id, stage_id) on delete cascade
);
comment on table public.gate_requirements is
  'Approval policy. A gate passes when every row is met: signers_required distinct people approving in one '
  'of the roles, or (null) every member holding one of the roles, with at least one such member. Rows are '
  'independent, so one person holding several roles can meet several rows (solo filmmaker). Only '
  'signers_required > 1 demands distinct people, and only within that row.';
create index gate_requirements_gate_idx on public.gate_requirements (project_id, stage_id);

create table public.gate_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  stage_id text not null,
  position smallint not null,
  label text not null check (char_length(label) between 1 and 200),
  done boolean not null default false,
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  unique (project_id, stage_id, position),
  foreign key (project_id, stage_id) references public.project_stages (project_id, stage_id) on delete cascade
);

-- Append-only: a changed mind is a new row; the latest row per (signer, role) counts. The same signer
-- may sign once per role they hold; repeating the latest decision in a role is rejected.
create table public.approval_decisions (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  stage_id text not null,
  signer_id uuid not null default auth.uid() references auth.users (id),
  acting_role public.project_role not null,
  decision public.gate_decision not null,
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (project_id, stage_id) references public.project_stages (project_id, stage_id)
);
comment on table public.approval_decisions is
  'Individual gate signatures. Append-only. signer_id is always auth.uid(); agents cannot sign.';
create index approval_decisions_gate_idx on public.approval_decisions (project_id, stage_id, signer_id, acting_role, id desc);
create index approval_decisions_signer_idx on public.approval_decisions (signer_id);

-- ---------------------------------------------------------------------------
-- Brain records and audit
-- ---------------------------------------------------------------------------

create table public.brain_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  stage_id text references public.stages (id),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'), -- e.g. idea_card, story_bible, note
  title text not null check (char_length(title) between 1 and 200),
  body jsonb not null default '{}',
  origin public.actor_kind not null default 'human',
  agent_key text, -- which agent drafted it; agent writes arrive in a later phase via the server
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((origin = 'agent') = (agent_key is not null))
);
comment on table public.brain_records is
  'Project Brain records. Agent-origin rows are AI drafts until a person accepts them (acceptance: later phase).';
create index brain_records_project_idx on public.brain_records (project_id, stage_id, created_at desc);
create index brain_records_created_by_idx on public.brain_records (created_by);

-- Written only by triggers. actor_id has no FK so history survives user deletion.
create table public.audit_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id),
  actor_kind public.actor_kind not null,
  actor_id uuid,
  action text not null,
  target_table text,
  target_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
comment on table public.audit_events is 'Append-only, trigger-written audit trail. Clients can only read.';
create index audit_events_project_idx on public.audit_events (project_id, id desc);

-- ---------------------------------------------------------------------------
-- RLS helpers (SECURITY DEFINER to avoid recursive RLS on project_members)
-- ---------------------------------------------------------------------------

create function private.is_member(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project and m.user_id = (select auth.uid())
  );
$$;

create function private.has_role(p_project uuid, p_roles public.project_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

create function private.shares_project(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members a
    join public.project_members b on b.project_id = a.project_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  );
$$;

-- Caller holds p_role (or, with null, any role) that appears in one of the gate's requirements.
create function private.can_act_on_gate(p_project uuid, p_stage text, p_role public.project_role default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.project_members m
    join public.gate_requirements r
      on r.project_id = m.project_id and r.stage_id = p_stage and m.role = any (r.roles)
    where m.project_id = p_project
      and m.user_id = (select auth.uid())
      and (p_role is null or m.role = p_role)
  );
$$;

create function private.gate_satisfied(p_project uuid, p_stage text) returns boolean
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (d.signer_id, d.acting_role) d.signer_id, d.acting_role, d.decision
    from public.approval_decisions d
    where d.project_id = p_project and d.stage_id = p_stage
    order by d.signer_id, d.acting_role, d.id desc
  ),
  -- an approval counts only while the signer still holds the role it was given in
  approved as (
    select l.signer_id, l.acting_role from latest l
    where l.decision = 'approve'
      and exists (select 1 from public.project_members m
                  where m.project_id = p_project and m.user_id = l.signer_id and m.role = l.acting_role)
  )
  select exists (select 1 from public.gate_requirements r where r.project_id = p_project and r.stage_id = p_stage)
    and not exists (
      select 1 from public.gate_checklist_items i
      where i.project_id = p_project and i.stage_id = p_stage and not i.done
    )
    and not exists (
      select 1 from public.gate_requirements r
      where r.project_id = p_project and r.stage_id = p_stage
        and case
          when r.signers_required is not null then
            (select count(distinct a.signer_id) from approved a where a.acting_role = any (r.roles))
              < r.signers_required
          else
            not exists (select 1 from public.project_members m
                        where m.project_id = p_project and m.role = any (r.roles))
            or exists (select 1 from public.project_members m
                       where m.project_id = p_project and m.role = any (r.roles)
                         and not exists (select 1 from approved a
                                         where a.signer_id = m.user_id and a.acting_role = m.role))
        end
    );
$$;

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- display_name only: user metadata is user-editable and never used for authorization
  insert into public.profiles (id, display_name)
  values (new.id, left(new.raw_user_meta_data ->> 'display_name', 120));
  return new;
end;
$$;

create function private.audit_member_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.project_members := coalesce(new, old);
begin
  if tg_op = 'DELETE' and r.role = 'producer' and not exists (
    select 1 from public.project_members m
    where m.project_id = r.project_id and m.role = 'producer' and m.id <> r.id
  ) and exists (select 1 from public.projects p where p.id = r.project_id) then
    raise exception 'A project must keep at least one producer' using errcode = '42501';
  end if;

  insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id, detail)
  values (r.project_id, case when auth.uid() is null then 'system' else 'human' end::public.actor_kind,
          auth.uid(), case tg_op when 'INSERT' then 'member.added' else 'member.removed' end,
          'project_members', r.id::text,
          jsonb_build_object('user_id', r.user_id, 'role', r.role, 'department', r.department));
  return r;
end;
$$;

create function private.before_checklist_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Checklist items are ticked by a signed-in person' using errcode = '42501';
  end if;
  if (new.project_id, new.stage_id, new.position, new.label) is distinct from
     (old.project_id, old.stage_id, old.position, old.label) then
    raise exception 'Only the done flag of a checklist item can change' using errcode = '42501';
  end if;
  if not exists (select 1 from public.project_stages s
                 where s.project_id = new.project_id and s.stage_id = new.stage_id and s.status = 'active') then
    raise exception 'Gate % is not open', new.stage_id using errcode = 'P0001';
  end if;
  if new.done is distinct from old.done then
    new.done_by := case when new.done then auth.uid() end;
    new.done_at := case when new.done then now() end;
    insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id, detail)
    values (new.project_id, 'human', auth.uid(), case when new.done then 'gate.item_checked' else 'gate.item_unchecked' end,
            'gate_checklist_items', new.id::text, jsonb_build_object('stage', new.stage_id, 'label', new.label));
  end if;
  return new;
end;
$$;

create function private.before_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.stage_status;
begin
  -- Triggers run even for service_role, so agent or server code without a user session cannot sign.
  if auth.uid() is null then
    raise exception 'Gate decisions require a signed-in person' using errcode = '42501';
  end if;
  new.signer_id := auth.uid();
  new.created_at := now();

  -- Row lock serialises decisions on one gate so the last signature always sees the others.
  select s.status into v_status from public.project_stages s
  where s.project_id = new.project_id and s.stage_id = new.stage_id
  for update;
  if v_status is distinct from 'active' then
    raise exception 'Gate % is not open for decisions', new.stage_id using errcode = 'P0001';
  end if;
  if not private.can_act_on_gate(new.project_id, new.stage_id, new.acting_role) then
    raise exception 'You do not hold role % for this gate', new.acting_role using errcode = '42501';
  end if;
  -- One person may sign in several roles, but repeating the same decision in the same role is a duplicate.
  if new.decision = (select d.decision from public.approval_decisions d
                     where d.project_id = new.project_id and d.stage_id = new.stage_id
                       and d.signer_id = new.signer_id and d.acting_role = new.acting_role
                     order by d.id desc limit 1) then
    raise exception 'You already recorded % as % on this gate', new.decision, new.acting_role using errcode = '23505';
  end if;
  if exists (select 1 from public.gate_checklist_items i
             where i.project_id = new.project_id and i.stage_id = new.stage_id and not i.done) then
    raise exception 'Gate % checklist is incomplete', new.stage_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function private.after_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_next text;
begin
  insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id, detail)
  values (new.project_id, 'human', new.signer_id, 'gate.decision', 'approval_decisions', new.id::text,
          jsonb_build_object('stage', new.stage_id, 'role', new.acting_role, 'decision', new.decision));

  if new.decision = 'approve' and private.gate_satisfied(new.project_id, new.stage_id) then
    update public.project_stages set status = 'passed', passed_at = now()
    where project_id = new.project_id and stage_id = new.stage_id and status = 'active';
    -- A multi-row insert (e.g. one person signing in all their roles) fires this once per row; pass once.
    if not found then
      return null;
    end if;

    select s.id into v_next from public.stages s
    where s.position = (select position + 1 from public.stages where id = new.stage_id);
    if v_next is not null then
      update public.project_stages set status = 'active', activated_at = now()
      where project_id = new.project_id and stage_id = v_next;
    end if;

    insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id, detail)
    values (new.project_id, 'system', null, 'gate.passed', 'project_stages', new.stage_id,
            jsonb_build_object('final_signer', new.signer_id, 'next_stage', v_next));
  end if;
  return null;
end;
$$;

create function private.audit_brain_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id, detail)
  values (new.project_id, new.origin, new.created_by, 'brain.record_created', 'brain_records', new.id::text,
          jsonb_build_object('kind', new.kind, 'stage', new.stage_id, 'agent', new.agent_key));
  return null;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger touch_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.projects
  for each row execute function private.touch_updated_at();
create trigger audit_member_change after insert or delete on public.project_members
  for each row execute function private.audit_member_change();
create trigger before_checklist_update before update on public.gate_checklist_items
  for each row execute function private.before_checklist_update();
create trigger before_decision before insert on public.approval_decisions
  for each row execute function private.before_decision();
create trigger after_decision after insert on public.approval_decisions
  for each row execute function private.after_decision();
create trigger append_only before update or delete on public.approval_decisions
  for each row execute function private.forbid_change();
create trigger append_only before update or delete on public.audit_events
  for each row execute function private.forbid_change();
create trigger audit_brain_record after insert on public.brain_records
  for each row execute function private.audit_brain_record();

-- ---------------------------------------------------------------------------
-- Project creation (the only way to create a project and its first producer)
-- ---------------------------------------------------------------------------

create function public.create_project(p_title text, p_code text default null, p_logline text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_project uuid;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to create a project' using errcode = '42501';
  end if;

  insert into public.projects (title, code, logline, created_by)
  values (p_title, p_code, p_logline, v_uid)
  returning id into v_project;

  insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id)
  values (v_project, 'human', v_uid, 'project.created', 'projects', v_project::text);

  insert into public.project_members (project_id, user_id, role, added_by)
  values (v_project, v_uid, 'producer', v_uid);

  insert into public.project_stages (project_id, stage_id, status, activated_at)
  select v_project, s.id,
         case when s.position = 1 then 'active' else 'locked' end::public.stage_status,
         case when s.position = 1 then now() end
  from public.stages s;

  insert into public.gate_requirements (project_id, stage_id, roles, signers_required)
  select v_project, t.stage_id, t.roles, t.signers_required from private.default_gate_requirements t;

  insert into public.gate_checklist_items (project_id, stage_id, position, label)
  select v_project, t.stage_id, t.position, t.label from private.default_gate_items t;

  return v_project;
end;
$$;
comment on function public.create_project is
  'Creates a project, makes the caller its producer and copies the default stages, gate policy and checklists.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.stages enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_stages enable row level security;
alter table public.gate_requirements enable row level security;
alter table public.gate_checklist_items enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.brain_records enable row level security;
alter table public.audit_events enable row level security;
alter table private.default_gate_requirements enable row level security;
alter table private.default_gate_items enable row level security;

create policy "stages are readable when signed in" on public.stages
  for select to authenticated using (true);

create policy "see own profile and co-members" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_project(id));
create policy "edit own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members see the project" on public.projects
  for select to authenticated using (private.is_member(id));
create policy "producers edit the project" on public.projects
  for update to authenticated
  using (private.has_role(id, '{producer}')) with check (private.has_role(id, '{producer}'));

create policy "members see the team" on public.project_members
  for select to authenticated using (private.is_member(project_id));
create policy "producers add members" on public.project_members
  for insert to authenticated
  with check (private.has_role(project_id, '{producer}') and added_by = (select auth.uid()));
create policy "producers remove members" on public.project_members
  for delete to authenticated using (private.has_role(project_id, '{producer}'));

create policy "members see stages" on public.project_stages
  for select to authenticated using (private.is_member(project_id));

create policy "members see gate policy" on public.gate_requirements
  for select to authenticated using (private.is_member(project_id));

create policy "members see checklists" on public.gate_checklist_items
  for select to authenticated using (private.is_member(project_id));
create policy "gate roles tick checklists" on public.gate_checklist_items
  for update to authenticated
  using (private.can_act_on_gate(project_id, stage_id))
  with check (private.can_act_on_gate(project_id, stage_id));

create policy "members see decisions" on public.approval_decisions
  for select to authenticated using (private.is_member(project_id));
create policy "gate roles sign as themselves" on public.approval_decisions
  for insert to authenticated
  with check (signer_id = (select auth.uid()) and private.can_act_on_gate(project_id, stage_id, acting_role));

create policy "members see brain records" on public.brain_records
  for select to authenticated using (private.is_member(project_id));
create policy "members add their own records" on public.brain_records
  for insert to authenticated
  with check (private.is_member(project_id) and origin = 'human' and created_by = (select auth.uid()));

create policy "members see the audit trail" on public.audit_events
  for select to authenticated using (private.is_member(project_id));

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; column-level writes for authenticated
-- ---------------------------------------------------------------------------

revoke all on public.stages, public.profiles, public.projects, public.project_members,
  public.project_stages, public.gate_requirements, public.gate_checklist_items,
  public.approval_decisions, public.brain_records, public.audit_events
  from anon, authenticated;
revoke all on private.default_gate_requirements, private.default_gate_items from anon, authenticated;
-- TRUNCATE skips row triggers, so it would bypass the append-only guard.
revoke truncate on public.approval_decisions, public.audit_events from service_role;

grant select on public.stages, public.profiles, public.projects, public.project_members,
  public.project_stages, public.gate_requirements, public.gate_checklist_items,
  public.approval_decisions, public.brain_records, public.audit_events
  to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (title, code, logline) on public.projects to authenticated;
grant insert (project_id, user_id, role, department), delete on public.project_members to authenticated;
grant update (done) on public.gate_checklist_items to authenticated;
grant insert (project_id, stage_id, acting_role, decision, note) on public.approval_decisions to authenticated;
grant insert (project_id, stage_id, kind, title, body) on public.brain_records to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid), private.has_role(uuid, public.project_role[]),
  private.shares_project(uuid), private.can_act_on_gate(uuid, text, public.project_role)
  to authenticated;

revoke execute on function public.create_project(text, text, text) from public, anon;
grant execute on function public.create_project(text, text, text) to authenticated;
