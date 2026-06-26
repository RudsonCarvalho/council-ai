# Security

This public repository must not contain real credentials, private prompts, customer data, saved sessions, or local research artifacts.

## Secrets policy

- Keep real keys only in `.env`, which is ignored by Git.
- Keep `.env.example` symbolic and provider-neutral.
- Do not hardcode provider keys in `config/`, `backend/`, `frontend/`, tests, docs, screenshots, or saved sessions.
- If a real key is committed accidentally, revoke it at the provider immediately and rotate the credential.

## Before publishing

Run a secret scan and review the staged diff:

```bash
git status --short
git diff --cached
```

Recommended optional checks:

```bash
gitleaks detect --no-git --source .
trufflehog filesystem .
```

## Runtime data

The `storage/` directory is for local runtime data. Public commits should include only placeholder files needed to preserve empty directories.
