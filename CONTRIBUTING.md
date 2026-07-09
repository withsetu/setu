# Contributing to Setu

Thanks for your interest in contributing! Setu is open source under the [MIT License](LICENSE),
and contributions are welcome.

## How to contribute

1. **Open an issue first** for anything non-trivial, so we can agree on the approach before code.
2. Fork the repo and create a branch off `main`.
3. Make your change with tests (`pnpm test`), and keep `pnpm typecheck` and `pnpm lint` clean.
4. Open a pull request that references the issue it addresses.

## Developer Certificate of Origin (DCO)

Setu accepts contributions under the **Developer Certificate of Origin** — a lightweight,
sign-off-based alternative to a CLA. By signing off on a commit, you certify that you wrote the
code (or otherwise have the right to submit it) under the project's MIT License. The full text is
at <https://developercertificate.org/>.

**Every commit must be signed off.** Add a `Signed-off-by` trailer with your real name and email:

```
Signed-off-by: Your Name <you@example.com>
```

Git adds this automatically when you commit with `-s`:

```bash
git commit -s -m "fix: correct the thing"
```

Set your identity once so the sign-off matches your commits:

```bash
git config user.name  "Your Name"
git config user.email "you@example.com"
```

Pull requests whose commits are not signed off can't be merged. If you forgot, amend the last
commit with `git commit --amend -s` (or rebase to sign off a series) and force-push your branch.

## License

By contributing, you agree that your contributions are licensed under the MIT License, the same
terms that cover the rest of the repository.
