## Architecture and why

The database folder. Its SQL folders are flat and their names fixed, so migrations run in order and every change is
reviewed. Denials end with "(Supabase layout)".

```text
config.toml, seed.sql
migrations/<timestamp>_<name>.sql   a 14-digit timestamp; flat
schemas/<NN>-<name>.sql   declarative schema files, a 2-digit order; flat
tests/database/<name>.test.sql   pgTAP tests
seeds/<name>.sql        flat, kebab-case
functions/<name>/       Edge Functions, one folder per function
templates/, snippets/   free layout
```

- A migration the branch's upstream or the remote default branch held when the prompt arrived is applied: it cannot be
  edited, deleted or moved, by tool or by shell. Restoring it is allowed, and your own unpushed migrations stay
  editable.
- Applying schema changes to a linked project is the user's step. `supabase db push`, `supabase link`, `supabase
migration up --linked` and the `supabase:deploy` script are denied; leave the migration committed and ask the user
  to deploy.
- Only `.gitkeep` may be hidden in the SQL folders.

## Where code goes

- Need a schema change → add a new migration with `supabase migration new <name>`; never change an applied one.
- Need a declarative schema file → put it in `schemas/` as `<NN>-<name>.sql`.
- Need a database test → put it in `tests/database/<name>.test.sql`.
- Need seed data → put it in `seed.sql` or `seeds/<name>.sql`.
- Need an Edge Function → give it a folder of its own under `functions/`.
- Need a fresh local database → reset the local stack with `supabase db reset`.
