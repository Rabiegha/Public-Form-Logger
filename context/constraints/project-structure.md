# Project Structure & Conventions

## Top-level directories

| Folder | Purpose |
|---|---|
| `src/` | NestJS source code (modules, controllers, services, DTOs). |
| `prisma/` | Prisma schema and migrations. |
| `views/` | EJS templates for the admin UI. |
| `public/` | Static assets served at `/admin/*` (CSS, etc.). |
| `tests/` | E2E tests (`*.e2e-spec.ts`). |
| `scripts/` | Operational scripts (seeders, backups). |
| `docs/` | User-facing or operational documentation. |
| `context/` | Context-mesh: architecture, decisions, constraints, playbooks. |
| `temp/` | Throwaway files. Anything here can be deleted at any time. |
| `archives/` | Deprecated/old artifacts kept for reference. Never imported by `src/`. |

## Files allowed at the repository root

Only:

- `package.json`, `package-lock.json`
- `Dockerfile`, `docker-compose.yml`
- `.env.example`, `.env.docker.example`, `.gitignore`, `.dockerignore`
- `.prettierrc`, `.eslintrc.cjs`
- `tsconfig.json`, `nest-cli.json`
- `README.md`

Everything else belongs in a subfolder.

## Module conventions inside `src/`

```
src/
├── app.module.ts
├── main.ts
├── config/                  ← env loading + global config
├── prisma/                  ← Prisma client wrapper
├── common/                  ← cross-cutting helpers (guards, interceptors)
└── modules/
    ├── health/
    ├── public-form-logs/    ← the public ingestion endpoint
    │   ├── dto/
    │   ├── public-form-logs.controller.ts
    │   ├── public-form-logs.service.ts
    │   └── public-form-logs.module.ts
    └── admin/               ← admin auth + admin endpoints + admin UI
        ├── dto/
        ├── admin-auth.service.ts
        ├── admin-auth.guard.ts
        ├── admin-auth.controller.ts
        ├── admin-logs.controller.ts
        ├── admin-ui.controller.ts
        └── admin.module.ts
```

## Naming conventions

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Variables / functions: `camelCase`
- Env variables: `UPPER_SNAKE_CASE`
- DB columns: `snake_case` (mapped via Prisma `@map`)
- Public API fields: `snake_case` (matches landing-page conventions)

## Forbidden

- No `*.bak`, `*.old`, `*.backup`, ad-hoc `manual-test.ts` files.
- No mixing of code and documentation in `src/`.
- No imports from `archives/` or `temp/`.
- No new file at the repo root without justification documented in `context/decisions/`.
