# Single source of truth for the gitleaks scanner image (#817).
#
# This image is never built from here — the file exists in Dockerfile shape only so that
# Dependabot's `docker` ecosystem can parse the reference and open a bump PR when a new
# gitleaks release ships (see .github/dependabot.yml). Dependabot cannot see an image
# reference embedded in a workflow's `run:` shell block, which is where this digest used
# to live, in two places at once.
#
# Both consumers read the FROM line of this file:
#   - .github/workflows/gitleaks.yml  (the CI gate)
#   - .githooks/pre-push              (the local pre-push scan, Docker fallback)
#
# Pinned by digest as well as tag: the tag is what Dependabot tracks, the digest is what
# actually gets pulled (third-party image, supply-chain hygiene — matches ci.yml's
# SHA-pinning convention for non-GitHub-owned actions). The pair was verified against the
# GHCR registry: ghcr.io/gitleaks/gitleaks:v8.30.1 resolves to this digest.
#
# Bumping: expect one triage pass on the first update — new detector rules can surface
# findings in existing history, and this job scans full history.
FROM ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
