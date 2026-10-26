#!/usr/bin/env bash
# Two-session race tests that pgTAP (one session, one transaction) cannot express.
# Needs a running local stack: supabase start. Writes committed rows, so run on a throwaway DB only.
# Local override, e.g.: PSQL="docker exec -i supabase_db_mithraa.shi psql -U postgres" bash supabase/tests/concurrency.sh
set -euo pipefail
PSQL=${PSQL:-psql postgresql://postgres:postgres@127.0.0.1:54322/postgres}
q() { $PSQL -v ON_ERROR_STOP=1 -Atq; }
A='{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}'
B='{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}'
as_user() { echo "begin; select set_config('request.jwt.claims','$1',true) \\g /dev/null
set local role authenticated;"; }
fail=0
check() {
  if [ "$2" = "$3" ]; then echo "ok - $1"; else fail=1; echo "not ok - $1 (got $2, want $3)"; fi
}

q <<'EOF'
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'race-a@example.test'),
  ('b0000000-0000-0000-0000-00000000000b', 'race-b@example.test')
on conflict do nothing;
EOF

# 1. Two producers remove each other at the same time: one must be refused.
pid=$(q <<EOF
$(as_user "$A")
select public.create_project('Race producers') \gset
insert into public.project_members (project_id, user_id, role) values (:'create_project', 'b0000000-0000-0000-0000-00000000000b', 'producer');
commit;
select :'create_project';
EOF
)
{ q <<EOF
$(as_user "$A")
delete from public.project_members where project_id = '$pid' and user_id = 'b0000000-0000-0000-0000-00000000000b';
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF 2>/dev/null || true
$(as_user "$B")
delete from public.project_members where project_id = '$pid' and user_id = 'a0000000-0000-0000-0000-00000000000a';
commit;
EOF
wait
check "concurrent producer removals keep one producer" \
  "$(q <<< "select count(*) from public.project_members where project_id = '$pid' and role = 'producer'")" 1

# 2. Unticking a checklist item while the final approval is in flight must not land on a passed gate.
pid=$(q <<EOF
$(as_user "$A")
select public.create_project('Race checklist') \gset
update public.gate_checklist_items set done = true where project_id = :'create_project' and stage_id = 'ideate';
commit;
select :'create_project';
EOF
)
{ q <<EOF
$(as_user "$A")
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values ('$pid', 'ideate', 'producer', 'approve');
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF 2>/dev/null || true
$(as_user "$A")
update public.gate_checklist_items set done = false where project_id = '$pid' and stage_id = 'ideate' and position = 2;
commit;
EOF
wait
check "passed gate keeps a complete checklist" \
  "$(q <<< "select bool_and(s.status <> 'passed' or i.done) from public.project_stages s
            join public.gate_checklist_items i using (project_id, stage_id)
            where s.project_id = '$pid' and s.stage_id = 'ideate'")" t

# Gate 6 with A as producer, director and Camera HOD; everything signed except Camera.
gate6_project() {
  local pid
  pid=$(q <<EOF
$(as_user "$A")
select public.create_project('Race HOD roster') \gset
insert into public.project_members (project_id, user_id, role, department) values
  (:'create_project', 'a0000000-0000-0000-0000-00000000000a', 'director', null),
  (:'create_project', 'a0000000-0000-0000-0000-00000000000a', 'hod', 'Camera');
commit;
select :'create_project';
EOF
  )
  q <<EOF
update public.project_stages set status = 'passed', passed_at = now() where project_id = '$pid' and stage_id in ('ideate', 'develop', 'write', 'protect', 'finance');
update public.project_stages set status = 'active', activated_at = now() where project_id = '$pid' and stage_id = 'prep';
$(as_user "$A")
update public.gate_checklist_items set done = true where project_id = '$pid' and stage_id = 'prep';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  ('$pid', 'prep', 'producer', 'approve'), ('$pid', 'prep', 'director', 'approve');
commit;
EOF
  echo "$pid"
}
add_hod() { echo "$(as_user "$A")
insert into public.project_members (project_id, user_id, role, department) values ('$1', 'b0000000-0000-0000-0000-00000000000b', 'hod', 'Sound');"; }
sign_camera() { echo "$(as_user "$A")
insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision) values ('$1', 'prep', 'hod', 'Camera', 'approve');"; }

# 3. A HOD department is added just before the final approval commits: the approval must wait and count it.
pid=$(gate6_project)
{ q <<EOF
$(add_hod "$pid")
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF
$(sign_camera "$pid")
commit;
EOF
wait
check "Gate 6 stays open for a HOD department added during the final approval" \
  "$(q <<< "select status from public.project_stages where project_id = '$pid' and stage_id = 'prep'")" active

# 4. The final approval is in flight when a HOD department is added: the change waits for the pass.
pid=$(gate6_project)
{ q <<EOF
$(sign_camera "$pid")
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
seen=$(q <<EOF
$(add_hod "$pid")
select status from public.project_stages where project_id = '$pid' and stage_id = 'prep';
commit;
EOF
)
wait
check "a HOD department added during the final approval lands after the pass" "$seen" passed


# 5. A HOD is added while the final Gate 5 signature is in flight, and the change stays open after Gate 6
#    opens: the last Gate 6 signature meanwhile must wait for the new HOD and leave Gate 6 open.
pid=$(gate6_project)
q <<EOF
update public.project_stages set status = 'locked', activated_at = null where project_id = '$pid' and stage_id = 'prep';
update public.project_stages set status = 'active', activated_at = now(), passed_at = null where project_id = '$pid' and stage_id = 'finance';
insert into public.project_members (project_id, user_id, role) values ('$pid', 'a0000000-0000-0000-0000-00000000000a', 'investor');
$(as_user "$A")
update public.gate_checklist_items set done = true where project_id = '$pid' and stage_id = 'finance';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values ('$pid', 'finance', 'producer', 'approve');
commit;
EOF
{ q <<EOF
$(as_user "$A")
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values ('$pid', 'finance', 'investor', 'approve');
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
{ q <<EOF
$(add_hod "$pid")
select pg_sleep(3) \g /dev/null
commit;
EOF
} & sleep 2
# Producer and director already signed Gate 6 in gate6_project; Camera is the last known signature.
q <<EOF
$(sign_camera "$pid")
commit;
EOF
wait
check "a HOD added while the previous gate passes still blocks the next gate" \
  "$(q <<< "select status from public.project_stages where project_id = '$pid' and stage_id = 'prep'")" active

# Gate 5 open with A and B both producers; nothing ticked or signed.
gate5_project() {
  local pid
  pid=$(q <<EOF
$(as_user "$A")
select public.create_project('Race modes') \gset
insert into public.project_members (project_id, user_id, role) values (:'create_project', 'b0000000-0000-0000-0000-00000000000b', 'producer');
commit;
select :'create_project';
EOF
  )
  q <<EOF
update public.project_stages set status = 'passed', passed_at = now() where project_id = '$pid' and stage_id in ('ideate', 'develop', 'write', 'protect');
update public.project_stages set status = 'active', activated_at = now() where project_id = '$pid' and stage_id = 'finance';
EOF
  echo "$pid"
}
set_mode() { echo "$(as_user "$1")
select public.set_project_mode('$2', 'financing', '$3') \\g /dev/null"; }
attest() { echo "$(as_user "$1")
insert into public.producer_attestations (project_id, stage_id) values ('$2', 'finance');"; }
# The mode, the Gate 5 policy and the Gate 5 checklist agree.
consistent() {
  q <<< "select (p.financing_mode = 'self') = not exists (select 1 from public.gate_requirements r
             where r.project_id = p.id and r.stage_id = 'finance' and r.roles = '{investor}')
           and (p.financing_mode = 'self') = exists (select 1 from public.gate_checklist_items i
             where i.project_id = p.id and i.stage_id = 'finance' and i.label like 'Self-financing%')
         from public.projects p where p.id = '$1'"
}

# 6. Two producers declare self-financing at once: one change, one audit event, consistent policy.
pid=$(gate5_project)
{ q <<EOF
$(set_mode "$A" "$pid" self)
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF
$(set_mode "$B" "$pid" self)
commit;
EOF
wait
check "concurrent mode changes apply once" \
  "$(q <<< "select count(*) from public.audit_events where project_id = '$pid' and action = 'project.mode_changed'")/$(consistent "$pid")" 1/t

# 7. The first checklist tick is in flight when a producer changes the mode: the change is refused.
pid=$(gate5_project)
{ q <<EOF
$(as_user "$A")
update public.gate_checklist_items set done = true where project_id = '$pid' and stage_id = 'finance' and position = 1;
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF 2>/dev/null || true
$(set_mode "$B" "$pid" self)
commit;
EOF
wait
check "a mode change waits for an in-flight checklist tick and is refused" \
  "$(q <<< "select financing_mode from public.projects where id = '$pid'")/$(consistent "$pid")" external/t

# 8. A mode change is in flight when the first tick arrives: the tick lands on no item of the old checklist.
pid=$(gate5_project)
{ q <<EOF
$(set_mode "$B" "$pid" self)
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF
$(as_user "$A")
update public.gate_checklist_items set done = true where project_id = '$pid' and stage_id = 'finance' and position = 1;
commit;
EOF
wait
check "a tick during a mode change does not touch the new checklist" \
  "$(q <<< "select count(*) filter (where done) from public.gate_checklist_items where project_id = '$pid' and stage_id = 'finance'")/$(consistent "$pid")" 0/t

# 9. An attestation is in flight when a producer switches back to external: the switch is refused.
pid=$(gate5_project)
q <<EOF
$(set_mode "$A" "$pid" self)
commit;
EOF
{ q <<EOF
$(attest "$A" "$pid")
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF 2>/dev/null || true
$(set_mode "$B" "$pid" external)
commit;
EOF
wait
check "a mode change during an attestation is refused" \
  "$(q <<< "select financing_mode from public.projects where id = '$pid'")/$(consistent "$pid")" self/t

# 10. Two producers attest the same gate at once: one attestation.
{ q <<EOF 2>/dev/null || true
$(attest "$B" "$pid")
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF 2>/dev/null || true
$(attest "$A" "$pid")
commit;
EOF
wait
check "a repeated attestation is refused" \
  "$(q <<< "select count(*) from public.producer_attestations where project_id = '$pid'")" 1

# 11. The final Gate 5 signature is in flight when a producer switches to external: the gate passes self-financed.
q <<EOF
$(as_user "$A")
update public.gate_checklist_items set done = true where project_id = '$pid' and stage_id = 'finance';
commit;
EOF
{ q <<EOF
$(as_user "$A")
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values ('$pid', 'finance', 'producer', 'approve');
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
q <<EOF 2>/dev/null || true
$(set_mode "$B" "$pid" external)
commit;
EOF
wait
check "a mode change during the final signature is refused" \
  "$(q <<< "select s.status || '/' || p.financing_mode from public.project_stages s join public.projects p on p.id = s.project_id
            where s.project_id = '$pid' and s.stage_id = 'finance'")/$(consistent "$pid")" passed/self/t

# Polls pg_stat_activity until $1 holds, for at most 10 s. Sessions signal each other through application_name.
wait_for() { echo "do \$\$ begin for i in 1..200 loop
  -- pg_stat_activity is frozen per transaction unless the snapshot is cleared.
  perform pg_stat_clear_snapshot();
  if exists (select 1 from pg_stat_activity where $1) then return; end if; perform pg_sleep(0.05);
end loop; raise exception 'timed out waiting for: %', \$w\$$1\$w\$; end \$\$;"; }

# 12. A removes producer B and holds the project lock; B's mode change queues behind it and, once A commits,
#     is refused because B is no longer a producer. Fails if the role check moves before the project lock.
pid=$(gate5_project)
{ q <<EOF
$(as_user "$A")
delete from public.project_members where project_id = '$pid' and user_id = 'b0000000-0000-0000-0000-00000000000b';
reset role;
set application_name = 'race_remover';
$(wait_for "application_name = 'race_mode_b' and wait_event_type = 'Lock'")
commit;
EOF
} &
err=$(q 2>&1 <<EOF || true
$(wait_for "application_name = 'race_remover'")
set application_name = 'race_mode_b';
$(set_mode "$B" "$pid" self)
commit;
EOF
)
wait
check "a mode change queued behind the producer's own removal is refused" \
  "$(grep -c 'Only a producer can change' <<< "$err")/$(q <<< "select financing_mode || '/' || (not exists (select 1 from public.project_members
      where project_id = '$pid' and user_id = 'b0000000-0000-0000-0000-00000000000b')) || '/' || (select count(*) from public.audit_events
      where project_id = '$pid' and action = 'project.mode_changed') from public.projects where id = '$pid'")/$(consistent "$pid")" \
  1/external/true/0/t

# 13. Two authenticated sessions submit the same idea and idempotency key
# concurrently. The advisory lock must serialize both calls and reuse one run.
idea_id=$(q <<EOF
$(as_user "$A")
select public.create_idea_draft('Two requests should produce one run') \gset
commit;
select :'create_idea_draft';
EOF
)
run_key='home-race-run-20261026-same-key'
first_file=$(mktemp)
{ q <<EOF >"$first_file"
$(as_user "$A")
select public.queue_idea_agent_run('$idea_id', '$run_key');
select pg_sleep(2) \g /dev/null
commit;
EOF
} & sleep 1
second_id=$(q <<EOF
$(as_user "$A")
select public.queue_idea_agent_run('$idea_id', '$run_key');
commit;
EOF
)
wait
first_id=$(cat "$first_file")
rm -f "$first_file"
check "concurrent same-key callers receive the same run id" "$first_id" "$second_id"
check "concurrent same-key queue creates only one run and four steps" \
  "$(q <<< "select (select count(*) from public.agent_runs where idea_id = '$idea_id' and idempotency_key = '$run_key') || '/' ||
             (select count(*) from public.agent_steps s join public.agent_runs r on r.id = s.run_id where r.idea_id = '$idea_id')")" \
  1/4

exit $fail
