# Payload Forms agent guide

Read README.md, INSTALL.md, and SECURITY.md before changing installation or authentication code.

- Read DEVELOPMENT.md before implementation. Confirm the Git remote/branch and classify the change as reusable application code, private installation operation, or a coordinated change. State the target repository, compatibility impact and checks before editing; never let a deployment repository become an unnoticed application fork.
- Reusable product changes belong here. Operator configuration/data/secrets remain private. Publish a checked version before a private update PR pins its full commit; public CI never deploys an installation. The automatic bridge to private deployments is not implemented. See DEVELOPMENT.md for compatibility and transition requirements.
- This is a standalone open-source questionnaire application. Supported targets are local development and an operator-owned Cloudflare account. A general Docker/VPS production target is not implemented.
- Use Node.js 26.3.0 and npm with package-lock.json. Use the commands in INSTALL.md; never invent provider permissions or remove release checks to make installation pass.
- Keep real configuration, credentials, respondent data, uploads, database exports, and operational notes out of Git and public logs. Use reserved example domains and fictional fixtures in tests. Never commit .env files or wrangler.install.jsonc.
- Local setup and Cloudflare configuration generation are offline. Creating remote resources, sending email, changing Access policies, applying remote migrations, or deploying requires the operator's explicit authorization. Never enable paid overage or raise limits automatically.
- Keep public participation separate from authenticated administration, responses, exports, analysis, media management, and MCP. Preserve exact origins, signature validation, team-role checks, atomic budgets, bounded bodies/retries, and warning delivery status.
- Fictional-data pretests remain the default. Real surveys require the explicit operator flag `FORMS_REAL_SURVEYS_ENABLED=1`, complete reviewed privacy settings and human-administrator activation of an immutable live version. Preserve these gates; installation alone never enables real collection. QA/evaluation runs and machine clients remain fictional/pretest-only. Privacy documentation is not a legal compliance certification.
- Never run integration tests against an existing installation. npm run test:ci creates disposable source/build/database trees and random test credentials. Keep production bindings out of test processes.
- Prefer small changes and the existing stack. Run npm test and npm run typecheck for application changes, and npm run test:ci when installation, persistence, authentication, migrations or Worker behavior changes.
- Additive migrations must preserve existing data and budget reservations. A code rollback does not restore a database; follow the backup and recovery notes in INSTALL.md.
- AI assistance is welcome. Review generated code, disclose material limitations, and do not claim tests ran or a deployment succeeded without evidence.

For Next.js APIs, consult the relevant guide shipped in node_modules/next/dist/docs before editing framework code.
