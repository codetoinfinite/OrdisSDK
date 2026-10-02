# Registry Pull Request Review

Registry pull requests are reviewed through deterministic JSON validation. Passing CI and trusted
validation against the latest `main` are required for merging.

The `Package Schema Check` workflow runs only when a pull request targeting `main` changes at least
one `packages/**/*.json` file. Once triggered, every changed path in the pull request must match
that scope. Multiple package JSON files are supported; mixing package JSON with documentation,
source, workflow, generated, or other files fails with `OUT_OF_SCOPE_CHANGE` and requires manual
review. Pull requests with no package JSON changes do not run this workflow and are reviewed
manually.

## Registry Rules

- Package JSON must match the strict registry schema. Unknown fields are rejected.
- A package with a non-empty `remotes` array must use a `packageName` beginning with
  `@alphesdk-remote/`.
- A package beginning with `@alphesdk-remote/` must define at least one remote endpoint.
- A remote package cannot define a custom `key`; its `packageName` is its registry and gateway
  identity.
- Remote endpoints must use HTTPS and cannot target localhost or private networks.
- A new file cannot reuse a `key`, or the fallback `packageName`, already present on the base
  branch.
- Existing historical key collisions are tolerated only while unchanged. A pull request cannot
  introduce a new collision.
- New package files must be placed directly in a configured category and use a lowercase
  kebab-case filename.
- Secret environment variables cannot define default values.

Run deterministic validation with:

```bash
node scripts/validate-registry.mjs --base origin/main
```

Validate the complete working tree with:

```bash
node scripts/validate-registry.mjs --all
```

## Pull Request Review

The deterministic reviewer may validate independent pull requests in parallel against `main`. It
must:

1. Inspect every changed file and reject unrelated repository, workflow, or dependency changes.
2. Run the trusted validator from `main` against a detached worktree containing the pull request.
3. Never install or execute a package, or probe a remote service, submitted by a pull request.
4. Present a review report containing the verdict, changed files, checks, warnings, and proposed
   merge method.
5. Ask for explicit approval to merge the pull request.

An invalid pull request is reported with blocking findings and is not offered for merge. Posting a
review comment, closing a pull request, or modifying a contributor branch requires separate user
approval.

To avoid executing code from the contributor branch, create a detached worktree and invoke the
validator from the trusted checkout while pointing `--root` at that worktree:

```bash
review_dir=$(mktemp -d)/pr
git fetch origin "pull/${pr_number}/head:refs/codex/review/${pr_number}"
git worktree add --detach "$review_dir" "refs/codex/review/${pr_number}"
node scripts/validate-registry.mjs --root "$review_dir" --base origin/main
git worktree remove "$review_dir"
```

## Merge Approval

Immediately before merging, the agent refreshes the pull request and confirms that:

- the pull request is not a draft;
- required checks passed;
- the pull request is mergeable and has no unresolved blocking discussion;
- the key remains unique against the latest `main`.

An approved registry pull request is squash-merged:

```bash
gh pr merge <number> --squash
```

The agent must not use `--admin` or `--auto`. After merging, it reports the resulting commit and
refreshes `main` before validating a new batch. Pull requests with pairwise-disjoint changed paths
and registry identities may submit squash merges concurrently; retry GitHub's transient
`Base branch was modified` rejection after another merge lands.
