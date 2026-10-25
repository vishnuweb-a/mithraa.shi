-- Phase 1A.2: self-financing and self-distribution (docs/SELF_FINANCING_DISTRIBUTION.md, R2).
--
-- A producer declares per project whether financing (Gate 5) and distribution (Gate 8) are external or
-- self. In self mode the investor / client row of that gate's policy is replaced by a producer row, the
-- third-party checklist item by an honest one, and the gate needs a producer attestation before anyone
-- signs it. No investor or buyer membership or approval is ever created. The declaration locks as soon
-- as its gate has any checklist action, attestation or decision.

create type public.operating_mode as enum ('external', 'self');

alter table public.projects
  add column financing_mode public.operating_mode not null default 'external',
  add column distribution_mode public.operating_mode not null default 'external';
comment on column public.projects.financing_mode is
  'Gate 5. self = no investor sign-off; the producer attests instead. Changed only through set_project_mode().';
comment on column public.projects.distribution_mode is
  'Gate 8. self = no buyer acceptance; the producer accepts internally and attests. Changed only through set_project_mode().';

-- Self-mode policy and checklist for the two gates. External mode uses the Phase 1A defaults.
create table private.self_gate_requirements (
  stage_id text not null references public.stages (id) check (stage_id in ('finance', 'post')),
  roles public.project_role[] not null check (cardinality(roles) > 0),
  signers_required smallint check (signers_required > 0)
);
insert into private.self_gate_requirements (stage_id, roles, signers_required) values
  ('finance', '{producer}', 1),
  ('post',    '{director}', 1),  -- final cut
  ('post',    '{producer}', 1);  -- internal delivery acceptance, in place of the buyer

create table private.self_gate_items (
  stage_id text not null references public.stages (id) check (stage_id in ('finance', 'post')),
  position smallint not null,
  label text not null,
  primary key (stage_id, position)
);
-- Nothing here claims funds are received or verified: that needs evidence this phase does not store.
insert into private.self_gate_items (stage_id, position, label) values
  ('finance', 1, 'Budget approved and baselined'),
  ('finance', 2, 'Self-financing plan recorded against the baseline budget'),
  ('post', 1, 'Final cut locked'),
  ('post', 2, 'CBFC certificate issued'),
  ('post', 3, 'Delivery package reviewed and accepted internally (no external buyer)');

alter table private.self_gate_requirements enable row level security;
alter table private.self_gate_items enable row level security;
revoke all on private.self_gate_requirements, private.self_gate_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Producer attestations
-- ---------------------------------------------------------------------------

create table public.producer_attestations (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  stage_id text not null check (stage_id in ('finance', 'post')),
  signer_id uuid not null default auth.uid() references auth.users (id),
  -- The default only makes the column optional in generated insert types; the trigger always replaces it.
  statement text not null default '' check (statement <> ''),
  created_at timestamptz not null default now(),
  unique (project_id, stage_id),
  foreign key (project_id, stage_id) references public.project_stages (project_id, stage_id)
);
comment on table public.producer_attestations is
  'A producer''s declaration on a self-financed Gate 5 or self-distributed Gate 8. Append-only; one per gate. '
  'signer_id, statement and created_at are set by trigger. It is a business record, not a gate signature.';
create index producer_attestations_signer_idx on public.producer_attestations (signer_id);

create function private.self_mode_gate(p_project uuid, p_stage text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project
      and ((p_stage = 'finance' and p.financing_mode = 'self') or (p_stage = 'post' and p.distribution_mode = 'self'))
  );
$$;

create function private.before_attestation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.stage_status;
begin
  -- Anonymous guests never sign, whatever role they were given.
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Attestations require a signed-in, non-anonymous person' using errcode = '42501';
  end if;
  new.signer_id := auth.uid();
  new.created_at := now();

  -- Same lock as a decision and a mode change, so the mode read below holds until commit.
  select s.status into v_status from public.project_stages s
  where s.project_id = new.project_id and s.stage_id = new.stage_id
  for update;
  -- Role first, so a non-member learns nothing about another project's gates.
  if not private.has_role(new.project_id, '{producer}') then
    raise exception 'Only a producer can attest' using errcode = '42501';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'Gate % is not open', new.stage_id using errcode = 'P0001';
  end if;
  if not private.self_mode_gate(new.project_id, new.stage_id) then
    raise exception 'Gate % is not declared self-financed or self-distributed', new.stage_id using errcode = 'P0001';
  end if;
  new.statement := case new.stage_id
    when 'finance' then 'I confirm, as an authorized producer, that this project is self-financed, its production '
      'budget has been reviewed, and I accept responsibility for the stated financing plan. This declaration is '
      'not an external investor approval.'
    else 'I confirm, as an authorized producer, that the completed delivery package has been reviewed and accepted '
      'internally for the project''s stated distribution plan. This does not represent acceptance by an external buyer.'
  end;

  -- Rolled back with the row if the insert fails (e.g. a duplicate).
  insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id, detail)
  values (new.project_id, 'human', new.signer_id, 'gate.attested', 'producer_attestations', new.id::text,
          jsonb_build_object('stage', new.stage_id));
  return new;
end;
$$;

create trigger before_attestation before insert on public.producer_attestations
  for each row execute function private.before_attestation();
create trigger append_only before update or delete on public.producer_attestations
  for each row execute function private.forbid_change();

alter table public.producer_attestations enable row level security;
create policy "members see attestations" on public.producer_attestations
  for select to authenticated using (private.is_member(project_id));
create policy "producers attest as themselves" on public.producer_attestations
  for insert to authenticated
  with check (signer_id = (select auth.uid()) and private.has_role(project_id, '{producer}'));

revoke all on public.producer_attestations from anon, authenticated;
revoke truncate on public.producer_attestations from service_role;
grant select on public.producer_attestations to authenticated;
grant insert (project_id, stage_id) on public.producer_attestations to authenticated;

-- ---------------------------------------------------------------------------
-- Decisions on a self-mode gate need the attestation first
-- ---------------------------------------------------------------------------

-- Phase 1A.1 body plus the attestation check. The attestation is immutable and the mode locks once it
-- exists, so checking before each decision is enough; gate_satisfied is unchanged.
create or replace function private.before_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.stage_status;
begin
  -- Triggers run even for service_role, so agent or server code without a user session cannot sign;
  -- anonymous guests never sign, whatever role they were given.
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Gate decisions require a signed-in, non-anonymous person' using errcode = '42501';
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
  -- A missing or misplaced department is left to the approval_decisions_department_only_for_hod check (23514).
  if new.acting_role = 'hod' and new.department is not null and not exists (
    select 1 from public.project_members m
    where m.project_id = new.project_id and m.user_id = new.signer_id
      and m.role = 'hod' and m.department = new.department
  ) then
    raise exception 'You are not HOD of % on this project', new.department using errcode = '42501';
  end if;
  -- One person may sign in several roles and HOD departments, but repeating the same decision in the same one is a duplicate.
  if new.decision = (select d.decision from public.approval_decisions d
                     where d.project_id = new.project_id and d.stage_id = new.stage_id
                       and d.signer_id = new.signer_id and d.acting_role = new.acting_role
                       and d.department is not distinct from new.department
                     order by d.id desc limit 1) then
    raise exception 'You already recorded % as % on this gate', new.decision,
      concat_ws(' ', new.acting_role, new.department) using errcode = '23505';
  end if;
  if exists (select 1 from public.gate_checklist_items i
             where i.project_id = new.project_id and i.stage_id = new.stage_id and not i.done) then
    raise exception 'Gate % checklist is incomplete', new.stage_id using errcode = 'P0001';
  end if;
  if private.self_mode_gate(new.project_id, new.stage_id) and not exists (
    select 1 from public.producer_attestations a where a.project_id = new.project_id and a.stage_id = new.stage_id
  ) then
    raise exception 'Gate % needs the producer attestation before decisions', new.stage_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mode selection
-- ---------------------------------------------------------------------------

create function public.set_project_mode(p_project uuid, p_setting text, p_mode public.operating_mode)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_stage text := case p_setting when 'financing' then 'finance' when 'distribution' then 'post' end;
  v_old public.operating_mode;
  v_status public.stage_status;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to change project settings' using errcode = '42501';
  end if;
  if v_stage is null or p_mode is null then
    raise exception 'Setting must be financing or distribution and mode external or self' using errcode = '22023';
  end if;

  -- Lock order project -> checklist items -> stage. A producer removal also locks the project before
  -- stages, and a checklist tick holds its item while it waits on the stage, so items come before it.
  -- A multi-item checklist update locks items in its own row order, not by position, so it can still
  -- deadlock with this call (40P01): Postgres rolls one transaction back whole. Callers re-read the project and retry a bounded number of times, only while
  -- the change is still allowed (see docs/SELF_FINANCING_DISTRIBUTION.md).
  select case p_setting when 'financing' then p.financing_mode else p.distribution_mode end into v_old
  from public.projects p where p.id = p_project
  for no key update;
  if not private.has_role(p_project, '{producer}') then
    raise exception 'Only a producer can change how the project is financed or distributed' using errcode = '42501';
  end if;
  if p_mode = v_old then
    return;
  end if;
  perform 1 from public.gate_checklist_items i
  where i.project_id = p_project and i.stage_id = v_stage
  order by i.position
  for update;
  select s.status into v_status from public.project_stages s
  where s.project_id = p_project and s.stage_id = v_stage
  for update;

  -- Locked once the gate has passed or holds any progress. Unticking leaves no row, so ticks come from the audit trail.
  if v_status = 'passed'
     or exists (select 1 from public.approval_decisions d where d.project_id = p_project and d.stage_id = v_stage)
     or exists (select 1 from public.producer_attestations a where a.project_id = p_project and a.stage_id = v_stage)
     or exists (select 1 from public.audit_events e
                where e.project_id = p_project and e.action in ('gate.item_checked', 'gate.item_unchecked')
                  and e.detail ->> 'stage' = v_stage) then
    raise exception 'Gate % already has progress, so its % mode is locked', v_stage, p_setting using errcode = 'P0001';
  end if;

  update public.projects set
    financing_mode = case when p_setting = 'financing' then p_mode else financing_mode end,
    distribution_mode = case when p_setting = 'distribution' then p_mode else distribution_mode end
  where id = p_project;

  delete from public.gate_requirements where project_id = p_project and stage_id = v_stage;
  insert into public.gate_requirements (project_id, stage_id, roles, signers_required)
  select p_project, t.stage_id, t.roles, t.signers_required from private.default_gate_requirements t
  where t.stage_id = v_stage and p_mode = 'external'
  union all
  select p_project, t.stage_id, t.roles, t.signers_required from private.self_gate_requirements t
  where t.stage_id = v_stage and p_mode = 'self';

  delete from public.gate_checklist_items where project_id = p_project and stage_id = v_stage;
  insert into public.gate_checklist_items (project_id, stage_id, position, label)
  select p_project, t.stage_id, t.position, t.label from private.default_gate_items t
  where t.stage_id = v_stage and p_mode = 'external'
  union all
  select p_project, t.stage_id, t.position, t.label from private.self_gate_items t
  where t.stage_id = v_stage and p_mode = 'self';

  insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id, detail)
  values (p_project, 'human', v_uid, 'project.mode_changed', 'projects', p_project::text,
          jsonb_build_object('setting', p_setting, 'stage', v_stage, 'from', v_old, 'to', p_mode));
end;
$$;
comment on function public.set_project_mode is
  'Producer-only. Sets financing (Gate 5) or distribution (Gate 8) to external or self and swaps that gate''s '
  'policy and checklist. Refused once the gate has passed or has any checklist action, attestation or decision. '
  'May fail with 40P01 (deadlock) against a concurrent checklist tick; the transaction is rolled back and is safe '
  'to retry after re-reading the project.';

revoke execute on function private.self_mode_gate(uuid, text), private.before_attestation() from public, anon, authenticated;
revoke execute on function public.set_project_mode(uuid, text, public.operating_mode) from public, anon;
grant execute on function public.set_project_mode(uuid, text, public.operating_mode) to authenticated;
