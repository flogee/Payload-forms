# Install Payload Forms

Supported: local development on Node.js 26.3.0 with npm, and a deployment in your own Cloudflare account. General Docker/VPS production hosting is not implemented. This release accepts fictional-data pretests only. The participant interface is German.

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

Recheck both public and private boundaries using a client without cookies: saved pretest, required JS/CSS, privacy notices, missing/foreign images, invalid non-writing submission, and protected admin/response/export/analysis/media/MCP routes. A successful provider save is not a successful anonymous test. Do not create fake records in an existing live database for a smoke test.

Future releases validate the exact public application inventory and run those HTTPS checks. Set `RELEASE_PROBE_SLUG` to an existing fictional pretest for that check (default `sample`). Drafts, closed forms and real research collection remain unavailable. Public sharing, research consent and privacy readiness are separate decisions.

## Verification, upgrades and recovery

Run `npm test`, `npm run typecheck` and `npm run test:ci`. The full suite uses disposable development and Worker databases, synthetic inputs and fresh secrets; it is never a live-site test. Do not point `test:http` at an existing installation.

Use **Bilder → Betriebskontingente** to inspect budgets and warning status. Verify warning delivery with your own operator-approved test and monitor failed/uncertain delivery. Provider acceptance alone does not prove inbox arrival. See SECURITY.md for limits and residual costs.

Before dependency upgrades, review the Payload authentication compatibility patch, regenerate the lockfile deliberately and rerun the native Worker suite. Do not use `npm audit fix --force` as an installation step.

For rollback, close the public exemption first if its guards cannot be trusted, then redeploy a previously verified Worker version. Keep database schema, stored data and budget reservations. A code rollback does not undo migrations; do not blindly restore old usage counters or run destructive down migrations.

## Brief for an AI installation agent

Read AGENTS.md, README.md, INSTALL.md and SECURITY.md. Confirm the requested target (loopback development or an operator-owned Cloudflare account). Use the documented setup/doctor/release commands. Request only missing configuration; keep secrets in private local files or secret stores. Do not modify source code to substitute domains, remove protection checks, make mail warnings optional, enable paid overage, or open alternate hostnames. Get explicit authorization before remote resource creation, policy changes, email tests, migrations and deployment. Report the exact checks performed and remaining limitations; stop on unverifiable preconditions instead of claiming installation success.
