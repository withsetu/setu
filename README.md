# Setu

An open-source, Git-backed CMS that runs as a local app, a self-hosted Node server, or on the edge
(Cloudflare Workers/Pages). Content lives in Git as Markdoc; the admin is a React SPA; the site is
Astro.

## Development

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev        # api :4444 · admin :5173 · site :4321
pnpm test       # run the test suites
pnpm typecheck  # whole-repo typecheck
```

## License

Setu is licensed under the [MIT License](LICENSE). Contributions are accepted under the
[Developer Certificate of Origin](CONTRIBUTING.md#developer-certificate-of-origin-dco) — sign off
your commits with `git commit -s`. See [CONTRIBUTING.md](CONTRIBUTING.md).
