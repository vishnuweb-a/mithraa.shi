-- Phase 1A.1: HOD approvals name their department (docs/PROJECT_BRAIN_DATABASE_ARCHITECTURE.md §4a R1).
--
-- One person may be HOD of several departments and signs for each one separately; a team splits the
-- departments across members. Department only distinguishes HOD rows: other roles' membership
-- `department` stays free-form metadata and their decisions never carry one.

-- A HOD membership without a department could never sign once HOD decisions require one.
alter table public.project_members
  add constraint project_members_hod_has_department check (role <> 'hod' or department is not null);

alter table public.approval_decisions
  add column department text check (char_length(department) between 1 and 60),
  add constraint approval_decisions_department_only_for_hod check ((acting_role = 'hod') = (department is not null));
comment on column public.approval_decisions.department is
  'Required for acting_role = hod (must match one of the signer''s HOD memberships); null for every other role.';
comment on table public.approval_decisions is
  'Individual gate signatures. Append-only. signer_id is always auth.uid(); agents cannot sign. '
  'The latest row per (signer, role, department) counts.';

grant insert (department) on public.approval_decisions to authenticated;

-- Department counts only for HOD rows, so a director with department metadata still matches a director approval.
create or replace function private.gate_satisfied(p_project uuid, p_stage text) returns boolean
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (d.signer_id, d.acting_role, d.department) d.signer_id, d.acting_role, d.department, d.decision
    from public.approval_decisions d
    where d.project_id = p_project and d.stage_id = p_stage
    order by d.signer_id, d.acting_role, d.department, d.id desc
  ),
  -- an approval counts only while the signer still holds the role (and, for a HOD, the department) it was given in
  approved as (
    select l.signer_id, l.acting_role, l.department from latest l
    where l.decision = 'approve'
      and exists (select 1 from public.project_members m
                  where m.project_id = p_project and m.user_id = l.signer_id and m.role = l.acting_role
                    and (m.role <> 'hod' or m.department = l.department))
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
                                         where a.signer_id = m.user_id and a.acting_role = m.role
                                           and (m.role <> 'hod' or a.department = m.department)))
        end
    );
$$;

create or replace function private.before_decision() returns trigger
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
  return new;
end;
$$;

create or replace function private.after_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_next text;
begin
  insert into public.audit_events (project_id, actor_kind, actor_id, action, target_table, target_id, detail)
  values (new.project_id, 'human', new.signer_id, 'gate.decision', 'approval_decisions', new.id::text,
          jsonb_build_object('stage', new.stage_id, 'role', new.acting_role, 'department', new.department,
                             'decision', new.decision));

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

-- A final signature holds FOR UPDATE on the active stage while it evaluates the roster. Membership changes
-- take the same lock, so the signature either sees an added/removed HOD or runs before it (never a passed
-- Gate 6 with a department that was assigned but unsigned). Passed gates are not re-evaluated.
create function private.lock_open_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.project_stages s
  where s.project_id = coalesce(new.project_id, old.project_id) and s.status = 'active'
  for update;
  return null;
end;
$$;
create trigger lock_open_gate after insert or delete on public.project_members
  for each row execute function private.lock_open_gate();
revoke execute on function private.lock_open_gate() from public, anon, authenticated;
