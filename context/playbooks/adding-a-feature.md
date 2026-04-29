# Adding a feature

## Where things go

| Need | Location |
|---|---|
| New HTTP route | New module under `src/modules/<feature>/` |
| Reusable guard/interceptor | `src/common/<topic>/` |
| New env variable | Add to `src/config/app-config.ts`, `.env.example`, `.env.docker.example` |
| New DB table or column | `prisma/schema.prisma` + `npm run prisma:migrate:dev` |
| Documentation for ops | `docs/` (user-facing) |
| Architecture / decision | `context/decisions/adr-XXX-<slug>.md` |
| Hard rule about repo layout | `context/constraints/` |

## Step-by-step

1. **Plan**: write a 1-paragraph note in the PR description. If the feature
   touches the public API contract or security, draft an ADR first.
2. **Schema first**: if a DB change is needed, edit `prisma/schema.prisma` and
   run `npm run prisma:migrate:dev -- --name <slug>`.
3. **Module skeleton**:
   - `src/modules/<feature>/<feature>.module.ts`
   - `src/modules/<feature>/<feature>.controller.ts`
   - `src/modules/<feature>/<feature>.service.ts`
   - `src/modules/<feature>/dto/*.dto.ts` (one DTO per request shape)
4. **Wire it** in `src/app.module.ts`.
5. **Tests**: add e2e cases under `tests/<feature>.e2e-spec.ts`. Cover at least
   happy path + 1 error path.
6. **Docs**: if the feature changes how operators run or deploy the service,
   update `README.md`. If it changes a constraint, update
   `context/constraints/`.

## Required for any change touching the public endpoint

- Cannot remove or change semantics of `submission_id` idempotency.
- Cannot widen rate limits without a security review note.
- Cannot log `form_payload` content to stdout/files. Ever.

## Required for any change touching admin

- Bcrypt rounds must remain ≥ 10.
- JWT secret must remain validated at boot (length ≥ 32).
- New admin endpoints **must** be protected by `AdminAuthGuard`.
