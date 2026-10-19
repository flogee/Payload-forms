# Development and release policy

Maintainer decision, 2026-10-16. This repository is the canonical source for reusable Payload Forms application code. Installation-specific operation belongs in an operator's private deployment repository and secret stores.

## Choose the repository before editing

Before changing files, confirm the current Git remote and branch and read the nearest AGENTS.md. State the change category, target repository, affected interfaces and intended validation in the task plan or pull request. Resolve routine classifications from this policy; ask only when a material requirement remains unclear.

| Change | Where it belongs |
| --- | --- |
| Reusable features, UI, response formats, validation, analysis, exports, MCP, authentication implementation, dependency fixes and reusable migrations | This public repository, through a focused pull request |
| An operator's domains, resource bindings, deployment credentials, access administration and deployment workflow | That operator's private deployment repository or secret store |
| Real questionnaire content, privacy/contact information, submissions and uploads | The operator's protected application/data workflow; never public fixtures or tests |
| A shared interface change that needs installation adjustments | Public compatibility change and release, then a separate private update pull request |

Do not maintain a second application fork in a deployment repository. An urgent installation hotfix must be recorded as an exception and followed by a sanitized upstream fix. Never push private history, operational notes, data, credentials or private issue links into this repository.

## Check compatibility in proportion to the change

For each pull request, state which interfaces change, or why none change. When affected, cover:

- Stored questionnaire/response formats, immutable versions, migration names and existing data.
- Authentication and password formats, stable application secrets, roles and access boundaries.
- Configuration variables, resource bindings, origins, image references and storage keys.
- HTTP/MCP/export contracts, dependency compatibility, budgets and warning behavior.

Provide an additive upgrade path, migration order and recovery notes for incompatible changes. Preserve old data and reservations. Do not silently change an existing installation's credentials or reset its database to make an update work.

Documentation-only changes need focused document/link/diff checks. Application changes follow the checks in AGENTS.md and CONTRIBUTING.md; installation/runtime/authentication/persistence changes require the disposable native Worker suite. Never use a live installation for integration tests.

## Product release and installation update

1. Develop and review reusable changes here; merge after the required CI succeeds.
2. Publish a reviewed version with its exact commit and relevant upgrade/migration notes. A public release does not deploy any operator's installation.
3. In the private deployment repository, prepare an update pull request selecting that release and full commit SHA together with the private configuration adjustments. Do not follow a moving main branch or a floating latest tag in production.
4. Check the selected application revision and private configuration together using synthetic, disposable tests without production credentials. Restrict deployment credentials to the private release stage.
5. After the operator-authorized release, record both application and deployment revisions, applied migrations and verification. A code rollback does not restore a database or justify resetting usage reservations.

Dependency/security updates follow the same path; passing CI alone does not install an update. Public contributor workflows must not receive installation credentials or call private deployments.

## Implementation status

The public repository currently has code CI and tagged source releases. Each operator supplies their own deployment process; this repository does not provide an automatic bridge to a private installation. A bridge must be implemented and verified separately before claiming that public releases update an installation.

Existing installations must first review configuration mappings, migration history, authentication/password compatibility, stable secrets, image references and recovery. Preserve their questionnaires, accounts, submissions and budget reservations. First-install bootstrap is not an upgrade procedure.

## Prepared compatibility boundary (not a deployment)

The local QA prototype is not a selected or published application release.
A private preparation must verify both a release tag and its full commit, then
test/build those exact committed bytes; a dirty worktree is not a release pin.
No public CI job receives installation credentials.

The fixed-parameter legacy `scrypt-soze-v1-n32768-r8-p3:` hash is verified with
the same N/r/p/key length as the current format. Successful password verification
may request rehash; no account, enabled flag or stored hash is rewritten by
installation. Access/team authorization remains separate. The postinstall
verifier accepts only exact upstream/current or explicitly reviewed prior patch
bytes, never an arbitrary modified authentication module.

This preparation accepts an absent QA flag or explicit `QA_MACHINE_ENABLED=0`.
Production child environments force it off and discard inherited machine
credentials/configuration. Enabling it or supplying machine audiences/clients
still fails installation validation. The existing Access inventory guard is
unchanged. A separate pure offline QA inventory validator and local atomic
client/installation budgets now supplement the prototype. They do not alter
that guard or enable the feature. Reviewed release wiring, actual ingress,
portable Run export/recovery and real-data acceptance remain separate work.
