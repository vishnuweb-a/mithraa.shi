# Independent Repository Setup

*Checked 2026-10-24 from the local clone and the public GitHub API (no token, no `gh` CLI).
Nothing was changed on GitHub and no remote was modified.*

## Current state (verified)

| Item | Value | Evidence |
| --- | --- | --- |
| Local branch | `main`, up to date with `origin/main` at `77ea338` | `git status`, `git ls-remote origin` |
| Remotes | `origin` → `https://github.com/vishnuweb-a/mithraa.shi.git` (fetch + push). **No `upstream`.** | `git remote -v` |
| `origin` repo | Public, default branch `main`, created 2026-10-23, **`fork: true`** | `GET /repos/vishnuweb-a/mithraa.shi` |
| Fork parent | **`pixawna/mithraa.shi`** (public, not itself a fork). Same 2 commits. | `parent.full_name`, `GET /repos/pixawna/mithraa.shi/commits` |
| Branch protection on `main` | **None** (`protected: false`) | `GET /repos/vishnuweb-a/mithraa.shi/branches` |
| Your permission level | **Not verified** (needs an authenticated call) | — |
| GitHub Actions | None committed before this onboarding. `.github/workflows/ci.yml` is new and uncommitted. | `git ls-files` |
| GitHub "Website" field | `https://mithraa-shi.vercel.app`, **the former team's deployment**, copied from the parent | `homepage` on both repos |
| Deployment integration on `origin` | Vercel posted a successful status on `77ea338` from project **`vishnus-projects-c4d53dca/mithraa-shi`** at 2026-10-24 16:40 UTC | `GET /repos/vishnuweb-a/mithraa.shi/commits/77ea338/status` |
| Deployment integration on parent | Vercel status from **`bhawna1203s-projects/mithraa-shi`** at 2026-10-21 | same call on `pixawna/mithraa.shi` |
| Local git identity | `Vishnu Bhardwaj <vb16vishnu@gmail.com>` | `git config` |
| Commit authors | `Bhawna🤖 <bhawnabc2002@gmail.com>` (both commits) | `git log` |
| Former-team references in tracked code | **None.** No hostnames, Vercel URLs, project IDs, team IDs or tokens. | `git grep` for `vishnuweb`, `bhawna`, `vercel.app`, domains |

### Answers to the Phase 2 questions

1. **Does `origin` point to your independent repository?** Probably yes. `vishnuweb-a/mithraa.shi`
   is a fork created the day before this audit, and the local git identity is "Vishnu". The brief
   called it the "original project", but GitHub shows the original is `pixawna/mithraa.shi`.
   **Confirm that `vishnuweb-a` is your account** (see the verification step below).
2. **Does `upstream` point to the original?** No `upstream` exists. That is fine.
3. **Do GitHub Actions or configs refer to the previous team?** No. There were no workflows, and
   no config file names them.
4. **Is deployment coupled to an old organization?** Not through the repo. Coupling lives only in
   GitHub/Vercel settings: the inherited Website field, and the former team's Vercel project,
   which deploys **their** repo, not yours. Your fork is already connected to a different Vercel
   scope (`vishnus-projects-c4d53dca`) whose ownership you must confirm.
5. **Does the code contain original URLs or integration IDs?** No.

## Recommended configuration

Keep it simple: **one remote you own (`origin`)**. Add an `upstream` only if you expect to pull
future changes from the former team.

```bash
# 1. Confirm you administer the fork (install GitHub CLI first, then `gh auth login`)
gh repo view vishnuweb-a/mithraa.shi --json nameWithOwner,viewerPermission,isFork,parent
#    expect viewerPermission = ADMIN

# 2. OPTIONAL: track the original read-only, with push disabled so it can never be pushed to
git remote add upstream https://github.com/pixawna/mithraa.shi.git
git remote set-url --push upstream DISABLED
git fetch upstream
```

These commands were **not run**. Run them only if you want them.

### Fork association: what it means and what to do

The GitHub fork link stays even if you change remotes. Practical effects:

- **Pull requests default to the parent.** In the GitHub UI and with `gh pr create`, the default
  base repository for a fork is `pixawna/mithraa.shi`. Always pick `vishnuweb-a/mithraa.shi` as
  the base. With the CLI, pass `--repo vishnuweb-a/mithraa.shi`, or run
  `gh repo set-default vishnuweb-a/mithraa.shi` once.
- **GitHub Actions are disabled on new forks** until you enable them in the repo's *Actions* tab.
- The repo is listed in the parent's fork network, and code search may treat it as a fork.

Independence does **not** require deleting history or attribution. Keep both commits and their
author. If you later want the fork link removed, use GitHub's *Leave fork network* /
"detach fork" request through GitHub Support. That is optional and was not done.

### Settings to change on GitHub (manual, by the repo admin)

1. *Settings → General → Website*: clear `https://mithraa-shi.vercel.app` or replace it with
   your own Vercel URL once confirmed.
2. *Actions → Enable workflows* (forks start disabled).
3. *Settings → Branches → Add rule for `main`* (or a ruleset):
   - Require a pull request before merging (1 approval, or 0 if you are the only maintainer)
   - Require status checks: **`verify`** (the CI job). Add **`Vercel`** once your project is confirmed.
   - Block force pushes and deletion
4. *Settings → Integrations → GitHub Apps* and your account's *Applications → Vercel*: confirm
   the Vercel app is installed by **you**, scoped to *Only select repositories*, and that no
   other deployment app has access.
5. *Settings → Collaborators*: confirm who has write/admin. Only you are expected.

## Branch and pull request workflow

```
main  ← protected; every commit on it is a production deployment
 └─ feat/<short-name> | fix/<short-name> | docs/<short-name>
      1. git switch -c feat/x  (from an up-to-date main)
      2. commit; git push -u origin feat/x
      3. open a PR into vishnuweb-a/mithraa.shi:main  ← check the base repo
      4. CI "verify" runs, and Vercel posts a Preview URL
      5. review the code and click through the Preview
      6. squash-merge, then delete the branch
      7. Vercel deploys main to Production; spot-check it
```

- Keep PRs small and single-purpose. Squash merge keeps `main` linear and easy to roll back.
- Never push straight to `main`; branch protection enforces this once enabled.
- Tag notable releases (`git tag v0.2.0 && git push origin v0.2.0`) so you can find a known-good
  commit quickly.
