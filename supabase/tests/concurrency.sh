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

exit $fail
