# Install Payload Forms

Supported: local development on Node.js 26.3.0 with npm, and a deployment in your own Cloudflare account. General Docker/VPS production hosting is not implemented. Fictional-data pretests are the default; real collection requires the explicit operator and per-version privacy gates below. The participant interface is German.

## Local development

1. Review AGENTS.md and SECURITY.md, then run `npm ci` and `npm run postinstall`. The second command explicitly verifies/applies the reviewed Payload authentication patch even if lifecycle scripts are globally disabled. Do not change global npm security settings.
2. Run `npm run setup:local`. It creates private `.env.local` with a new secret, simulated email and loopback origin. It never overwrites an existing file or creates remote resources.
3. Run `npm run doctor:local`, then `npm run dev`.
4. Open `http://127.0.0.1:3212/admin`, create the first local account, and use the editor to create a fictional questionnaire. The first account becomes administrator; anonymous registration then closes. Local setup does not silently create accounts or questionnaires.
5. Set the questionnaire to pretest and open its saved `/f/<slug>` link. Use invented data only. The test suite and optional remote bootstrap use the synthetic structural example in `src/survey/sample.ts`.

Keep `.env.local` private. Do not expose the development server to a network or tunnel. Local login is for development; the documented Cloudflare deployment uses verified Access identities and existing active team records.

## Prepare your Cloudflare installation

These steps require your explicit authorization and your own resources. Setup commands do not provision or deploy anything. Check current account-wide quotas, pricing/overage rules and spending controls before creating resources. Other apps can share quotas. Never enable paid overage or accept billing terms automatically.

Run `npm run setup:cloudflare`. It creates ignored `wrangler.install.jsonc` from the checked-in JSON example. It refuses to overwrite an existing configuration. Edit **env.internal** in that private file; the fixed environment name is a tool selection label, not a shared service.

Provision and configure:

- Your account ID, a unique Worker name, and one private D1 database. Set its own name/ID and binding `D1`. Prefer the operator's intended jurisdiction and verify it before use; this release requires the image bucket in the EU.
- One private EU Standard R2 bucket as `MEDIA`. Do not enable r2.dev, a public bucket domain or direct client uploads. Use your own bucket name.
- Between one and ten complete custom-domain hostnames. Match routes and `SURVEY_ORIGINS` exactly; no wildcard or URL path. Keep `workers_dev=false`, `preview_urls=false`, `LOCAL_PROTOTYPE=0` and `DISABLE_SCHEMA_PUSH=1`.
- A Cloudflare Access self-hosted application covering **all** those complete hosts, with exactly one reusable human-email allow policy assigned exclusively to it. Configure your own team domain, app ID, audience, account ID and policy ID. Enable email one-time codes or another intended identity provider. Initially allow exactly one administrator email, matching `ACCESS_INITIAL_EMAILS`.
- A verified mail sender/domain and verified destination addresses in your own Cloudflare account. Set `MAIL_FROM`, `MAIL_ORIGIN`, `MAIL_ALLOWED_RECIPIENTS` and `OPS_ALERT_RECIPIENT` consistently with the restricted EMAIL binding. Keep warnings enabled; recipient configuration grants no application access. If the service is unavailable or verification is incomplete, stop rather than bypassing checks.
- Five-minute cron, the existing CPU/body/image/mail/public-usage budgets, and two **different**, account-unique positive rate-limit namespace IDs. Ensure these namespaces do not collide with other installations in your account. Do not automatically raise the checked limits.
- Your own persistent random `PAYLOAD_SECRET` (at least 32 characters), a restricted Worker `ACCESS_SYNC_TOKEN` for the selected Access policy, and a restricted deployment API token. Never commit or log these values. Provision the same Payload secret and the sync token in the selected Worker's secret store before release.

The deployment token needs the actions used by release: Workers scripts/deployment and custom-domain routing, D1 migration access, account/zone reads, Access applications and policies read, and **Account Email Routing Addresses Read** to verify the selected mail destinations. The separate sync token needs only the Access policy operations required by team synchronization in that account. Use the narrowest provider-supported account/zone scope; some permissions apply account-wide rather than to a single database or Worker. Do not reuse another installation's tokens.

Official references: [Workers](https://developers.cloudflare.com/workers/), [D1](https://developers.cloudflare.com/d1/), [R2 jurisdiction](https://developers.cloudflare.com/r2/reference/data-location/), [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), [Email Routing](https://developers.cloudflare.com/email-routing/), [rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Explicit configuration and release

In a **private local shell**, select the ignored configuration:

```sh
export PAYLOAD_FORMS_CONFIG=wrangler.install.jsonc
```

Supply the stable `PAYLOAD_SECRET` and `CLOUDFLARE_API_TOKEN` from your secret manager into that process environment without logging them. Do not put secret values in shell history or public CI variables. These production commands ignore local development binding files and use the same selected configuration in Payload, OpenNext and Wrangler.

```sh
npm run doctor:cloudflare
npm run build:cloudflare
```

The doctor validates offline configuration; it does not prove that remote resources exist or that mail reached an inbox. A production build may require an authenticated provider context for local binding emulation; do not describe it as a remote deployment or apply migrations implicitly.

The optional QA machine connector remains off unless its **complete explicit**
nonsecret configuration is selected in `env.internal.vars`. The local
[coordinated release preflight](EVALUATION-RUNS.md#prepared-coordinated-release-wiring)
adds exact live Access metadata checks; it does not create an app, policy,
token or resource, and is not an authorization to enable or deploy a pilot.
The deployment reader also needs the provider's service-token metadata read
permission. Stop on missing permission or unsupported inventory; never broaden
permissions or bypass checks automatically. Human/team and public-participation
requirements above remain unchanged.

Before a remote migration, record a fresh D1 recovery point, the existing schema/migration state and minimal aggregate counts. Maintain operator-controlled backups and test recovery with fictional disposable data. Never copy live data into this repository.

For the **first explicitly authorized** release, while the whole hosts are still protected:

```sh
npm run release:cloudflare -- --migrate --bootstrap
```

Release checks remote Access/allowlists and verified email destinations, checks that both Worker secrets exist, builds and dry-runs, then applies only explicitly selected migrations/bootstrap and deploys. Bootstrap creates exactly one first administrator for the configured initial email only when the users collection is empty, and creates the fictional `/f/sample` pretest only if absent. It never changes existing accounts, revives disabled accounts, replaces surveys or rotates secrets. Open `/admin` through Access with that email. Do not use Payload's local first-register endpoint in Access mode; local password login is intentionally disabled.

Later releases use `npm run release:cloudflare`; add `--migrate` only for reviewed pending migrations. Separate `migrate:cloudflare` and `bootstrap:cloudflare` commands are available for deliberate operations with the same validated configuration; they do not replace the release's online preflight. Do not run them on an unidentified database.

For an existing installation whose stable `PAYLOAD_SECRET` is held only in the
Worker secret store, an operator may explicitly choose:

```sh
npm run release:cloudflare -- --runtime-secret-only
```

Leave `PAYLOAD_SECRET` unset in this release process; even an empty supplied value
is rejected. This mode verifies the existing `PAYLOAD_SECRET` and
`ACCESS_SYNC_TOKEN` secret names before building. It never reads their values,
creates a secret or rotates one. A fresh transient key exists only in the build
child environment (and the reviewed migration child when explicitly requested),
never in installation configuration, assets or logs. The deployed Worker keeps
its existing secrets; OpenNext loads runtime bindings before importing the server.
All Access, mail, dry-run and HTTPS checks still apply, and QA settings remain
explicitly selected through the normal configuration validation.

`--bootstrap` is forbidden in this mode. Add `--migrate` only after the normal
backup and migration review: a fail-closed identity guard permits exactly the
reviewed SQL-only migration files, index, Payload configuration and migration CLI
with Payload/D1 adapter 3.90.2. Any changed, missing or new executable migration,
configuration or supported version requires a fresh review before updating that
guard; do not automatically regenerate its digests. A migration using Payload
data APIs, encryption or key-dependent hooks requires the stable secret instead.
The default release and the separate build/migrate/bootstrap commands continue
to require the supplied stable key because arbitrary application operations may
depend on it. This compatibility option is an existing-installation upgrade path.

## Enable anonymous participation

First deploy the guards and budgets behind whole-host protection. Then, with the operator's explicit permission, create a **separate** Access self-hosted application named `Payload-forms – Teilnahme` containing exactly these four paths on **each** configured host:

```text
/f/*
/datenschutz/*
/api/survey/submit
/_next/static/*
```

Assign exactly one Everyone bypass policy without extra selectors, require/exclude conditions or overrides. Keep the existing whole-host team application and its sole reusable allow policy unchanged. More-specific participation paths bypass Access only for this route set; the application guard rejects unsupported methods/subpaths and restricts images to the reachable questionnaire.

The participation name is a shared display label, not an account-wide installation
identifier. Release checks discover it only through destinations overlapping this
installation's configured hosts. Same-name applications on verifiably disjoint
hosts may coexist; unknown destinations, overlapping alternatives and a configured
public app ID belonging to another installation still stop the release. An offline
QA inventory must explicitly identify its own participation app when present.

Recheck both public and private boundaries using a client without cookies: saved pretest, required JS/CSS, privacy notices, missing/foreign images, invalid non-writing submission, and protected admin/response/export/analysis/media/MCP routes. A successful provider save is not a successful anonymous test. Do not create fake records in an existing live database for a smoke test.

Future releases validate the exact public application inventory and run those HTTPS checks. Set `RELEASE_PROBE_SLUG` to an existing fictional pretest for that check (default `sample`). Drafts and closed forms remain unavailable. Real collection requires the separate activation below. Public sharing, research consent and privacy readiness are separate decisions.

## Real surveys

Real collection is **off by default**. In the selected private `env.internal.vars`, set `FORMS_REAL_SURVEYS_ENABLED` to the string `"1"` only when the operator intends to enable it, then use the normal reviewed build/release process. The string `"0"` or omission disables it; malformed values are rejected by installation validation and never enable runtime collection. Ambient shell settings cannot opt a production installation in. Local development uses the same flag in private `.env.local`, with synthetic inputs only. Setup and bootstrap keep it off and create only the fictional pretest.

Before opening a particular real questionnaire, a human administrator must save a complete privacy profile, mark it as reviewed, and activate status **Echte Erhebung**. This includes controller/contact details, purpose, legal basis and its explanation, data categories, recipients, transfers, retention, rights, complaint authority and the applicable consent/contact wording. The application checks completeness and the review marker; the operator owns substantive review. This is not legal certification or an anonymity guarantee. Keep actual questionnaire text, operator details, responses and contacts in the protected installation workflow.

The live participant page presents the saved notice and a separate participation confirmation. The submission contract requires `confirmParticipation: true`; fictional pretests retain `confirmTest: true`. Missing, mixed or wrong-mode confirmations fail. A live submission requires the current notice hash and any consent required by its legal basis. Optional contact information can always be omitted. An opted-in live contact needs its own consent and a valid email address; a personal name is optional. Pretests continue to require invented contact names and `.invalid` email addresses. Contacts remain separate from answers, but their association remains possible for follow-up; this is not anonymous data storage.

A started instrument, version, slug and privacy notice are frozen. Close that version and duplicate it to a new draft/version for changes; closed versions cannot reopen or switch mode. Operational branding, notifications and retention reminders retain their existing edit rules. Live insertions atomically check the current phase and reviewed privacy profile. New real responses and separate contacts carry `testOnly=false`; old test records stay unchanged. Normal CSV exports exclude contacts and preserve each record's actual test marker. Protected team analysis identifies test, real or mixed datasets, including after closure. Machine identities cannot access real instruments, raw real responses, separate contacts or real analysis; QA/evaluation runs remain fictional pretests even when this flag is enabled.

To stop real collection, set the selected flag to `"0"` and release that configuration. New runtime requests then stop serving real participant forms, notices, scoped images, share links and submissions. Removing the runtime flag also fails closed, even for an enabled build. Saved responses remain real, team-protected and subject to the existing erasure/retention workflow; disabling the flag does not delete, anonymize or relabel them. Fictional pretests continue to work. Closing an individual live version is also available while the operator flag is off.

No migration is required for this feature: existing phase, privacy receipt and test-marker fields are reused. Upgrades preserve accounts, secrets, responses and budget reservations. A rollback to a pretest-only release stops real participation and may show outdated labels or omit real data from analysis; preserve stored data and select a compatible reviewed release before resuming collection. The release probe must remain an existing fictional pretest and performs no real submission.

## Verification, upgrades and recovery

Run `npm test`, `npm run typecheck` and `npm run test:ci`. The full suite uses disposable development and Worker databases, synthetic inputs and fresh secrets; it is never a live-site test. Do not point `test:http` at an existing installation.

Use **Bilder → Betriebskontingente** to inspect budgets and warning status. Verify warning delivery with your own operator-approved test and monitor failed/uncertain delivery. Provider acceptance alone does not prove inbox arrival. See SECURITY.md for limits and residual costs.

Before dependency upgrades, review the Payload authentication compatibility patch, regenerate the lockfile deliberately and rerun the native Worker suite. Do not use `npm audit fix --force` as an installation step.

For rollback, close the public exemption first if its guards cannot be trusted, then redeploy a previously verified Worker version. Keep database schema, stored data and budget reservations. A code rollback does not undo migrations; do not blindly restore old usage counters or run destructive down migrations.

## Brief for an AI installation agent

Read AGENTS.md, README.md, INSTALL.md and SECURITY.md. Confirm the requested target (loopback development or an operator-owned Cloudflare account). Use the documented setup/doctor/release commands. Request only missing configuration; keep secrets in private local files or secret stores. Do not modify source code to substitute domains, remove protection checks, make mail warnings optional, enable paid overage, or open alternate hostnames. Get explicit authorization before remote resource creation, policy changes, email tests, migrations and deployment. Report the exact checks performed and remaining limitations; stop on unverifiable preconditions instead of claiming installation success.
