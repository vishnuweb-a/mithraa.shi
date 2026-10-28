-- Phase 1C.5: strict agent order, a bounded failure policy, and token usage for
-- failed attempts. Forward-only: replaces the 1C.3a worker RPCs in place.
-- Apply this migration BEFORE deploying the app code that passes p_error_detail.

-- Internal; runs under the caller's run lock. A failed step ends the run: every
-- later step is skipped, never executed, and completed outputs are kept.
create function public.settle_home_agent_run(p_run_id uuid, p_now timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.agent_steps s where s.run_id = p_run_id and s.status = 'failed') then
    update public.agent_steps set status = 'skipped', finished_at = p_now,
      lease_token = null, lease_expires_at = null, error_code = 'prerequisite_failed'
      where run_id = p_run_id and status in ('queued','running');
  end if;
  if not exists (select 1 from public.agent_steps s
    where s.run_id = p_run_id and s.status in ('queued','running')) then
    update public.agent_runs r set status =
      case when exists (select 1 from public.agent_steps s where s.run_id = p_run_id and s.status = 'failed')
      then case when exists (select 1 from public.agent_steps s
        where s.run_id = p_run_id and s.status = 'completed') then 'partial' else 'failed' end
      else 'completed' end,
      finished_at = p_now
      where r.id = p_run_id and r.status in ('queued','running');
  end if;
end;
$$;

revoke all on function public.settle_home_agent_run(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.claim_home_agent_step(p_run_id uuid default null)
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

  -- Also repairs runs left 'running' by the old claim, which bypassed failed steps.
  perform public.settle_home_agent_run(v_run.id, v_now);

  -- Strict order, including steps awaiting a retry. Failed steps never get here.
  select * into v_step from public.agent_steps s
  where s.run_id = v_run.id and s.status in ('queued','running')
  order by case s.agent_key
    when 'idea_capture' then 1 when 'market_scout' then 2
    when 'premise_scorer' then 3 else 4 end
  limit 1 for update;
  if not found then return; end if;

  if v_step.status = 'queued' and v_step.next_attempt_at > v_now then return; end if;
  if v_step.status = 'running' and v_step.lease_expires_at > v_now then return; end if;

  if v_step.attempts >= 3 then
    update public.agent_steps set status = 'failed', finished_at = v_now,
      lease_token = null, lease_expires_at = null,
      error_code = 'attempts_exhausted', error_message = null
      where id = v_step.id;
    perform public.settle_home_agent_run(v_run.id, v_now);
    return;
  end if;

  -- error_message keeps the previous attempt's validator detail for a corrective retry.
  v_token := gen_random_uuid();
  update public.agent_steps set status = 'running', lease_token = v_token,
    lease_expires_at = v_now + interval '120 seconds',
    attempts = attempts + 1, started_at = coalesce(started_at, v_now),
    error_code = null where id = v_step.id;
  update public.agent_runs set status = 'running',
    started_at = coalesce(started_at, v_now) where id = v_run.id;
  return query select v_step.id, v_run.id, v_step.agent_key, v_token, v_step.attempts + 1;
end;
$$;

drop function public.finish_home_agent_step(
  uuid,uuid,text,jsonb,text,text,text,bigint,bigint,text,text,boolean,integer,jsonb);

create function public.finish_home_agent_step(
  p_step_id uuid, p_lease_token uuid, p_outcome text,
  p_output jsonb default null, p_provider text default null,
  p_model text default null, p_prompt_version text default null,
  p_input_tokens bigint default null, p_output_tokens bigint default null,
  p_usage_source text default 'unavailable',
  p_error_code text default null, p_retryable boolean default false,
  p_retry_after_seconds integer default null,
  p_sources jsonb default '[]'::jsonb,
  p_error_detail text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_run public.agent_runs%rowtype;
  v_step public.agent_steps%rowtype;
  v_now timestamptz := clock_timestamp();
  v_entry jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted worker only' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('completed','failed') then
    raise exception 'Invalid step outcome' using errcode = '22023';
  end if;
  if p_sources is null or jsonb_typeof(p_sources) <> 'array'
    or jsonb_array_length(p_sources) > 20 then
    raise exception 'Invalid source payload' using errcode = '22023';
  end if;
  if p_usage_source is null or p_usage_source not in ('provider','estimated','unavailable') then
    raise exception 'Invalid usage source' using errcode = '22023';
  end if;

  -- Lock order matches claim_home_agent_step: run, then step.
  select r.* into v_run from public.agent_runs r
    join public.agent_steps s on s.run_id = r.id
    where s.id = p_step_id for update of r;
  if not found then return false; end if;
  select * into v_step from public.agent_steps where id = p_step_id for update;
  if v_step.status <> 'running'
    or v_step.lease_token is distinct from p_lease_token
    or v_step.lease_expires_at <= v_now then
    return false;
  end if;

  if v_run.cancel_requested_at is not null then
    update public.agent_steps set status = 'skipped', finished_at = v_now,
      lease_token = null, lease_expires_at = null where id = p_step_id;
    update public.agent_steps set status = 'skipped', finished_at = v_now
      where run_id = v_run.id and status = 'queued';
    update public.agent_runs set status = 'cancelled', finished_at = v_now
      where id = v_run.id;
    return true;
  end if;

  if p_outcome = 'completed' then
    if p_output is null or jsonb_typeof(p_output) <> 'object'
      or p_provider is null or p_model is null or p_prompt_version is null then
      raise exception 'Incomplete trusted result' using errcode = '22023';
    end if;
    update public.agent_steps set status = 'completed', finished_at = v_now,
      output = p_output, provider = p_provider, model = p_model,
      prompt_version = p_prompt_version, error_code = null, error_message = null,
      lease_token = null, lease_expires_at = null where id = p_step_id;

    -- Source candidates remain verified=false until independently checked.
    for v_entry in select value from jsonb_array_elements(p_sources) loop
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Invalid source record' using errcode = '22023';
      end if;
      insert into public.research_sources
        (step_id,source_url,title,claim_ref,source_type,verified)
      values (p_step_id,v_entry->>'url',v_entry->>'title',
        v_entry->>'claim','web',false);
    end loop;
  elsif p_retryable and v_step.attempts < 3 then
    update public.agent_steps set status = 'queued',
      next_attempt_at = v_now + make_interval(secs =>
        greatest(5,least(3600,coalesce(p_retry_after_seconds,10 * v_step.attempts)))),
      lease_token = null, lease_expires_at = null,
      error_code = left(coalesce(p_error_code,'retryable_error'),80),
      error_message = left(p_error_detail,200)
    where id = p_step_id;
  else
    update public.agent_steps set status = 'failed', finished_at = v_now,
      lease_token = null, lease_expires_at = null,
      error_code = left(coalesce(p_error_code,'provider_error'),80),
      error_message = left(p_error_detail,200)
    where id = p_step_id;
  end if;

  -- One usage row per step totals every attempt, including failed ones.
  if p_provider is not null and p_model is not null then
    insert into public.agent_usage as u
      (step_id,provider,model,input_tokens,output_tokens,usage_source)
    values (p_step_id,p_provider,p_model,p_input_tokens,p_output_tokens,p_usage_source)
    on conflict (step_id) do update set
      provider = excluded.provider, model = excluded.model,
      input_tokens = case when u.input_tokens is null and excluded.input_tokens is null then null
        else coalesce(u.input_tokens,0) + coalesce(excluded.input_tokens,0) end,
      output_tokens = case when u.output_tokens is null and excluded.output_tokens is null then null
        else coalesce(u.output_tokens,0) + coalesce(excluded.output_tokens,0) end,
      usage_source = case when u.usage_source = excluded.usage_source
        then u.usage_source else 'estimated' end,
      recorded_at = v_now;
  end if;

  perform public.settle_home_agent_run(v_run.id, v_now);
  return true;
end;
$$;

revoke all on function public.finish_home_agent_step(
  uuid,uuid,text,jsonb,text,text,text,bigint,bigint,text,text,boolean,integer,jsonb,text
) from public, anon, authenticated;
grant execute on function public.finish_home_agent_step(
  uuid,uuid,text,jsonb,text,text,text,bigint,bigint,text,text,boolean,integer,jsonb,text
) to service_role;
