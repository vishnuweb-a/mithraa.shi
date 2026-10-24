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

exit $fail
