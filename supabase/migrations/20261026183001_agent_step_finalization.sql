-- Phase 1C.3a: commit validated step results, usage, and source candidates atomically.
-- This SECURITY DEFINER RPC is callable only by service_role; never from clients.
create function public.finish_home_agent_step(
  p_step_id uuid, p_lease_token uuid, p_outcome text,
  p_output jsonb default null, p_provider text default null,
  p_model text default null, p_prompt_version text default null,
  p_input_tokens bigint default null, p_output_tokens bigint default null,
  p_usage_source text default 'unavailable',
  p_error_code text default null, p_retryable boolean default false,
  p_retry_after_seconds integer default null,
  p_sources jsonb default '[]'::jsonb
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
      or p_provider is null or p_model is null or p_prompt_version is null
      or p_usage_source is null or p_usage_source not in ('provider','estimated','unavailable') then
      raise exception 'Incomplete trusted result' using errcode = '22023';
    end if;
    update public.agent_steps set status = 'completed', finished_at = v_now,
      output = p_output, provider = p_provider, model = p_model,
      prompt_version = p_prompt_version,
      lease_token = null, lease_expires_at = null where id = p_step_id;

    insert into public.agent_usage
      (step_id,provider,model,input_tokens,output_tokens,usage_source)
    values (p_step_id,p_provider,p_model,p_input_tokens,p_output_tokens,p_usage_source);

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
  else
    if p_retryable and v_step.attempts < 3 then
      update public.agent_steps set status = 'queued',
        next_attempt_at = v_now + make_interval(secs =>
          greatest(5,least(3600,coalesce(p_retry_after_seconds,10 * v_step.attempts)))),
        lease_token = null, lease_expires_at = null,
        error_code = left(coalesce(p_error_code,'retryable_error'),80),
        error_message = 'Temporary provider failure'
      where id = p_step_id;
    else
      update public.agent_steps set status = 'failed', finished_at = v_now,
        lease_token = null, lease_expires_at = null,
        error_code = left(coalesce(p_error_code,'provider_error'),80),
        error_message = 'Agent step could not complete'
      where id = p_step_id;
    end if;
  end if;

  if not exists (select 1 from public.agent_steps s
    where s.run_id = v_run.id and s.status in ('queued','running')) then
    update public.agent_runs set status =
      case when exists (select 1 from public.agent_steps s
        where s.run_id = v_run.id and s.status = 'failed')
        then case when exists (select 1 from public.agent_steps s
          where s.run_id = v_run.id and s.status = 'completed') then 'partial' else 'failed' end
        else 'completed' end,
      finished_at = v_now where id = v_run.id;
  end if;
  return true;
end;
$$;

revoke all on function public.finish_home_agent_step(
  uuid,uuid,text,jsonb,text,text,text,bigint,bigint,text,text,boolean,integer,jsonb
) from public, anon, authenticated;
grant execute on function public.finish_home_agent_step(
  uuid,uuid,text,jsonb,text,text,text,bigint,bigint,text,text,boolean,integer,jsonb
) to service_role;
