import { deny, KEBAB, type ContentProfile, type PathVerdict } from "./shape.ts";

/** The database types a backend's CLI writes, such as Supabase's database.types.ts and pocketbase-typegen's pocketbase-types.ts. */
export const GENERATED_TYPES = /(?:\.|-)types\.ts$/;
/** GENERATED_TYPES as the globs ESLint, Prettier and knip read. */
export const GENERATED_TYPE_GLOBS: readonly string[] = ["*.types.ts", "*-types.ts"];

const ok: PathVerdict = { ok: true };

/** The Next shapes speak without a layout suffix and end a sentence; the others end with theirs. */
const ending = (text: string, layout: string): string => (layout === "" ? `${text}.` : `${text} ${layout}`);

/** One flat folder for the one backend client: the client, its test and the generated types, so a connection is opened in one place. */
export function checkBackendFolder(inside: readonly string[], folder: string, layout: string): PathVerdict {
  const file = inside.at(-1) ?? "";
  if (inside.length > 1) return deny("nesting", ending(`Keep ${folder} flat: the backend client, its test and the generated types, no subfolder`, layout));
  if (file === ".gitkeep") return ok;
  if (!file.endsWith(".ts")) {
    return deny("src-shape", ending(`Keep ${folder} to .ts files: the backend client, its test and the generated types`, layout));
  }
  if (!KEBAB.test(file.replace(/(?:\.test|\.types)?\.ts$/, "")))
    return deny("file-name", ending(`Use a kebab-case name in ${folder}, such as client.ts`, layout));
  return ok;
}

export const backendProfile = (scope: RegExp, allowed: RegExp, where: string, layout: string): NonNullable<ContentProfile["backend"]> => ({
  scope,
  allowed,
  message: ending(
    `Import a backend package only in ${where}, which holds the one client; elsewhere import that client, or the package's types with "import type"`,
    layout,
  ),
});
