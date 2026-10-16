# Payload Forms

An MIT-licensed, self-hosted questionnaire application built with Payload CMS, Next.js, and Cloudflare Workers. Maintained by Florian Bauernfeind.

Create versioned questionnaires, share a participation link or QR code, and review responses in a protected administration area. The participant interface is currently German. This initial public release supports **pretests with fictional data**; real research collection is deliberately disabled.

## What is included

- Twelve response formats: single and multiple choice, short and long text, numbers, numeric rows, Likert/matrix rows, repeatable lists, sliders, stars, smileys, and ranking.
- A section-based editor with rich text, image blocks, and per-questionnaire header branding.
- Anonymous participation links with protected team administration, individual responses, exports, and analysis.
- Versioned privacy notices, separate contact records, retention reminders, questionnaire duplication and JSON/Markdown/CSV downloads.
- Charts and SVG downloads, plus limited MCP tools for drafts and reduced statistical reports.
- Atomic usage budgets, rate limits, bounded uploads and request bodies, and bounded operational warnings.

## Try it locally

```sh
npm ci
npm run postinstall
npm run setup:local
npm run dev
```

Setup generates a new local-only application secret and refuses to overwrite an existing environment. Keep `.env.local` private. Open `http://127.0.0.1:3212/admin`, create the first local account, then create your own fictional questionnaire. No account or questionnaire is silently provisioned by this local setup. Tests and the optional Cloudflare bootstrap use the fictional fixture in `src/survey/sample.ts`. The explicit postinstall command also works when npm lifecycle scripts are disabled globally.

Read [INSTALL.md](INSTALL.md) for supported versions, precise setup commands, an agent installation brief, Cloudflare prerequisites, validation, and recovery. Remote deployment is never performed automatically by local setup.

## Development

```sh
npm test
npm run typecheck
npm run test:ci
```

The last command runs a fresh database, development HTTP tests, and a native Worker build and HTTP suite in disposable directories. It does not use a live deployment. See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## Deployment and privacy

Each operator supplies their own account, domains, database, private image bucket, Access policies, mail verification and warning recipient. Installation configuration and secrets remain outside version control. This repository contains no hosted service credentials, operational history, original research questionnaire, respondent records, or original deployment configuration.

Workers/D1/R2/Access bindings are required for the documented Cloudflare deployment. Running the Next.js development server on a laptop is not a standalone production server. General Docker/VPS production support is future work.

Usage limits reduce specific application operations; they are not an account-wide spending cap. Other projects, direct provider access, rejected requests, and database checks can still incur provider usage. Privacy notices and retention reminders require operator configuration; automatic anonymization is not implemented. See [SECURITY.md](SECURITY.md).

## License and attribution

Copyright (c) 2026 Florian Bauernfeind. [MIT License](LICENSE): commercial use, modification, redistribution and forks are welcome. Retain the copyright and license notice in redistributed copies or substantial portions. A visible UI credit is appreciated but is not an additional license condition.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the vendored Payload authentication compatibility code. This project is independent and is not endorsed by Payload CMS or OpenAI.
