# Security Policy

## Supported versions

Popkorn is pre-1.0. Only the latest published `@popkorn/*` release on npm gets
security fixes.

## Reporting a vulnerability

Please **don't** open a public issue. Use GitHub's private reporting:

<https://github.com/ayarse/popkorn/security/advisories/new>

Include what you did, what happened, and what you expected. Expect a first
response within a week.

## Scope

In scope: the parser, player, renderers, converters, and the playground at
usepopkorn.dev. Popkorn scenes are a data format — the player treats scene
source as untrusted input, so parser crashes, hangs, or anything that escapes
the canvas from a scene file are valid reports.

Out of scope: denial of service from deliberately enormous scenes, and issues
that require a malicious dependency already installed in the host app.
