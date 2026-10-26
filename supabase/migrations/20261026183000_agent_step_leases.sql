-- Phase 1C.3a: trusted, crash-recoverable step leases. No UI or Groq calls.
alter table public.agent_steps
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column next_attempt_at timestamptz not null default now();

alter table public.agent_steps add constraint agent_steps_lease_consistency check (
  (status = 'running' and lease_token is not null and lease_expires_at is not null)
  or (status <> 'running' and lease_token is null and lease_expires_at is null)
);

create index agent_steps_claim_idx on public.agent_steps (run_id, next_attempt_at)
  where status in ('queued','running');

-- Worker must serialize on the parent run before attempting a step.
create function public.claim_home_agent_step(p_run_id uuid default null)
returns table (step_id uuid, claimed_run_id uuid, agent_key text, lease_token uuid, attempt_number integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.agent_runs%rowtype;
  v_step public.agent_steps%rowtype;
  v_token uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted worker only' using errcode = '42501';
  end if;

  select * into v_run from public.agent_runs r
  where (p_run_id is null or r.id = p_run_id)
    and r.status in ('queued','running')
  order by r.created_at, r.id
  limit 1 for update skip locked;
  if not found then return; end if;

  -- Prevent two live workers from claiming separate steps on the same run.
  if exists (select 1 from public.agent_steps s
    where s.run_id = v_run.id and s.status = 'running'
      and s.lease_expires_at > v_now) then return; end if;

  if v_run.cancel_requested_at is not null then
    update public.agent_steps s set status = 'skipped', finished_at = v_now,
      lease_token = null, lease_expires_at = null
      where s.run_id = v_run.id and s.status in ('queued','running');
    update public.agent_runs set status = 'cancelled', finished_at = v_now
      where id = v_run.id;
    return;
  end if;

  -- Strict order, including steps awaiting a retry.
  select * into v_step from public.agent_steps s
  where s.run_id = v_run.id and s.status in ('queued','running')
  order by case s.agent_key
    when 'idea_capture' then 1 when 'market_scout' then 2
    when 'premise_scorer' then 3 else 4 end
  limit 1 for update;

  if not found then
    update public.agent_runs r set status =
      case when exists (select 1 from public.agent_steps s
        where s.run_id = v_run.id and s.status = 'failed')
      then case when exists (select 1 from public.agent_steps s
        where s.run_id = v_run.id and s.status = 'completed') then 'partial' else 'failed' end
      else 'completed' end,
      finished_at = v_now where r.id = v_run.id;
    return;
  end if;

  if v_step.status = 'queued' and v_step.next_attempt_at > v_now then return; end if;
  if v_step.status = 'running' and v_step.lease_expires_at > v_now then return; end if;

  if v_step.attempts >= 3 then
    update public.agent_steps set status = 'failed', finished_at = v_now,
      lease_token = null, lease_expires_at = null,
      error_code = 'attempts_exhausted', error_message = 'Previous worker lease expired'
      where id = v_step.id;
    return;
  end if;

  v_token := gen_random_uuid();
  update public.agent_steps set status = 'running', lease_token = v_token,
    lease_expires_at = v_now + interval '120 seconds',
    attempts = attempts + 1, started_at = coalesce(started_at, v_now),
    error_code = null, error_message = null where id = v_step.id;
  update public.agent_runs set status = 'running',
    started_at = coalesce(started_at, v_now) where id = v_run.id;
  return query select v_step.id, v_run.id, v_step.agent_key, v_token, v_step.attempts + 1;
end;
$$;

revoke all on function public.claim_home_agent_step(uuid) from public, anon, authenticated;
grant execute on function public.claim_home_agent_step(uuid) to service_role;
