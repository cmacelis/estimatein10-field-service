# Verification — November 20, 2026

- TypeScript check and Vite production build: passed.
- Dependency audit: zero known vulnerabilities after updating the extracted app to Express 4.22.3 and Vite 8.3.8.
- Seven HTTP/PostgreSQL integration tests: passed, zero skipped. Tests run in `.local/test`, separate from `.local/demo`.
- Browser on macOS Chrome: opened the locally built app, navigated to job #1001, marked its visit arrived, completed it with fictional notes, completed the job, reloaded, and confirmed the completed job and notes persisted.
- Database restart: stopped and restarted this app's own demonstration PostgreSQL cluster, then confirmed job #1001 was still completed. The web server was restarted afterward.
- Desktop and narrow-screen layouts were visually inspected. Local verification screenshots are excluded from the source distribution.
- Runtime: local Node/Express process, own PostgreSQL cluster, no cloud SDK dependencies or original environment configuration. CSP restricts browser connections to the same origin.
- Six extracted core modules matched the source hashes in the extraction manifest byte-for-byte. The job-transition module retains only the completion action, as documented in the manifest.

Limits: this is not a production authentication system, a full offline-Linux validation, a complete service-history implementation, a full original-repository secrets audit, or a production-readiness certification. npm installation needs package access/cache; PostgreSQL and btree_gist must already be available on the target machine. Advanced workflows remain unfinished by design.
