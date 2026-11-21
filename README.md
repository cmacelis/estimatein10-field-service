# EstimateIn10 Field Service — local extraction

A standalone web development baseline extracted from selected EstimateIn10 field-service modules. It runs against its own local PostgreSQL cluster using fictional data. The original app, its Git history, production credentials, and cloud integrations are not included.

This is a local development baseline, licensed under the [MIT License](LICENSE). Third-party dependencies retain their respective licenses.

## Requirements

- macOS or Linux, Node.js 22.12+ and npm.
- PostgreSQL 14+ server tools on PATH: `initdb`, `pg_ctl`, `psql`. PostgreSQL's `btree_gist` extension must be installed (often the distribution's contrib package).
- An ordinary user account; PostgreSQL cannot initialize as root.
- No Docker, Supabase account, API keys, GPU, or outside service is required at runtime.
- Internet access or configured package mirrors/cache is needed for the initial npm installation. This has been verified on macOS; execution on Linux remains unverified.

## Run

From this folder:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4317. Startup initializes and seeds its own database on first use. Later startups preserve existing changes and do not reseed or reset it. `FIELD_SERVICE_PORT` can select a different application port.

The web server listens on loopback only. PostgreSQL listens only on a Unix socket beneath `.local/demo/socket`; it does not listen on TCP. No system PostgreSQL service is changed. Generic `DATABASE_URL`, Supabase settings, and original EstimateIn10 environment files are not loaded.

Stop the web server with Ctrl-C. Stop this app's database with:

```sh
npm run db:stop
```

The next `npm start` restarts it. `npm run db:setup` and `npm run db:start` are also available. All generated data stays in `.local/` inside this folder.

## Included behavior

- Fictional business with an owner and two technicians, four jobs, four visits, three customers, and two equipment records. A separate fictional tenant is a test fixture and is excluded from the interface.
- Technician-grouped schedule, job details, and a read-only equipment register.
- Existing visit actions: reschedule/reassign, en route, arrive, complete with service notes.
- Existing job completion guard: all visits must be terminal and at least one must be complete.
- Existing transactional dispatcher, audit entries, idempotent retries, role/assignment checks, and technician conflict checks; a database exclusion constraint also blocks overlapping open visits.
- Local notification-event log. Events are retained in the outbox as pending and never sent to email, SMS, or push providers.

The user selector is a deliberate demonstration identity mechanism, not secure production authentication. The server resolves the selected fictional person's role and business; it does not accept roles or tenant IDs supplied by the browser. This app is intended for local fictional-data development only.

## Try it

1. Select Avery Morgan (owner) and open Jobs.
2. Open a scheduled job. Use Edit schedule to change a time or technician. An overlapping assignment is rejected.
3. Mark a visit arrived, then complete it with fictional service notes.
4. Complete the job once all its visits are finished.
5. Check Activity for committed/rejected events and local notifications.
6. Reload the browser or restart the web server to verify the stored state.
7. Select Jordan or Sam to see technician restrictions.

A fresh setup starts with the scheduled fictional fixtures. Existing local data may reflect actions taken while trying the app. Tests use a different cluster and never reset the demonstration database.

## Deliberately unfinished

The following workflows remain planned development:

- Day/week planning, technician availability/time off, and scheduling an unscheduled job.
- Creating follow-up visits and extending multi-visit lifecycle operations.
- Equipment management and service-history links.
- Recurring maintenance plans and retry-safe due-job generation, as a possible extension.

The extracted single-visit reschedule logic also updates the parent job's summary schedule. A multi-visit scheduling policy needs to be designed as part of the future work. Equipment records are not currently linked to visits; the inventory is not a service-history implementation.

## Checks

```sh
npm run build
npm test
node scripts/check-extraction.mjs
```

`npm test` creates/resets only `.local/test` and stops that PostgreSQL cluster afterward. It runs real HTTP/API and PostgreSQL checks for tenant boundaries, role/assignment restrictions, conflict rollback, adjacent scheduling, concurrent scheduling, completion guards, reconnect persistence, idempotent retries, date validation, and same-origin protection. PostgreSQL database files persist locally; only the disposable test schema is reset.

See `docs/EXTRACTION.json` for the explicit source-file manifest, `docs/EXTRACTION.md` for the adaptation boundary, and `docs/VERIFICATION.md` for verification evidence and limits.

## Sharing boundary

Do not share the entire folder as-is: it contains generated `.local` database files and `node_modules` after setup. A future publication must use an explicit source allowlist, exclude `.local`, `node_modules`, `dist`, and verification screenshots as appropriate, and use new Git history. No original history is included. Review the exact source files before a public release.

## License

The code and documentation in this standalone project are licensed under the [MIT License](LICENSE), copyright 2026 Chuler Macelis. This license applies to this standalone distribution; it does not grant rights to the rest of the original EstimateIn10 application. Third-party packages remain governed by their own licenses.

The package remains marked `private: true` to prevent accidental npm publication. This flag does not control GitHub repository visibility.
