# Extraction boundary

This standalone app is derived from selected field-service modules in EstimateIn10. `EXTRACTION.json` records the source paths, SHA-256 hashes, destinations, and adaptations for those modules. The full application and its Git history are not included.

## Preserved code

The PostgreSQL transaction helper, dispatcher engine, registry/errors, visit transition module, and schedule-conflict helper were copied unchanged. Job transitions retain the existing completion action and its guards, with invoice creation removed. These modules carry the state machine, tenant scoping, authorization, transaction rollback, idempotency, and audit/outbox behavior from the original app.

The name `dispatcher` in these files means the command/state-transition engine, not the dispatch calendar interface.

## Adapted or new code

- `db/schema.sql`: reduced PostgreSQL schema based on the field-service data model. Supabase roles, profile references, bridge RPCs, billing, estimates, invoice tables, and payment tables are omitted. Compatible dispatcher event/idempotency/outbox fields and status guards are retained, together with the open-visit overlap constraint.
- `db/seed.sql`: newly authored, fictional data only. Reserved `.test` email addresses and visibly fictional asset identifiers are used. No database export was copied.
- `server/app.js`: new local-only API adapter for the extracted transitions and tenant-scoped read queries. No original monolithic routes/server startup were copied.
- `client`: a small replacement React/TypeScript interface for the selected baseline workflows. The original monolithic Work Center, public customer pages, AI-estimating UI, marketing pages, native apps, and private assets are not included. The interface inherits the original's light surfaces, blue controls, and operating vocabulary.
- `scripts/database.mjs`: private, app-owned PostgreSQL cluster and portable setup; no production configuration is consumed.
- `tests`: newly authored integration checks against a separate disposable local cluster.

## Excluded

Original Git history, `.env` files, passwords and service credentials, accounts and customer data, deployment configuration, Supabase authentication/storage and legacy bridges, AI providers, Stripe and App Store billing, email/push senders, analytics, marketing material, mobile binaries/signing, internal runbooks, and backups.

Only the specifically listed source files were read/copied into the extracted core. The extraction does not claim that every file in the original repository has been audited. Third-party npm dependencies are installed independently with a fresh lockfile; their own licenses still apply.

## License status

This standalone distribution is licensed under the [MIT License](../LICENSE), copyright 2026 Chuler Macelis. The grant covers the files included here, including the selected field-service modules; it does not extend to excluded code from the original application. Third-party dependencies retain their respective licenses. `private: true` prevents accidental npm publication; it does not control GitHub repository visibility.
