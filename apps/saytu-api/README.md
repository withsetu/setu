# @setu/api — local git API

Exposes the GitPort (git-local) over HTTP so the in-browser admin can commit to the real repo.

## Run everything (api + admin + site)
From the repo root:

    pnpm dev

- api:   http://localhost:4444  (env: SAYTU_API_PORT, SAYTU_REPO_DIR)
- admin: http://localhost:5173  (env: VITE_SAYTU_API → the api URL)
- site:  http://localhost:4321

With the admin pointed at the api (VITE_SAYTU_API), **Publish** commits the real
`.mdoc` into repo-root `content/` and the site renders it. Without VITE_SAYTU_API the
admin runs fully in-browser (no server). Local-only; the api has no auth.

Note: git-local needs a normal git checkout — it does not follow a git *worktree's*
`.git` pointer file, so run `pnpm dev` from a normal clone (SAYTU_REPO_DIR), not a worktree.
