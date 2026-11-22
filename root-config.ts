import { z } from "zod";

/** Two literal leading folders, so a `root.allow` glob never opens a whole top-level folder: that is what `root.entries` does. */
const allowGlob = z
  .string()
  .refine((value) => !value.startsWith("/") && !value.split("/").some((part) => part === ".." || part === "."), "must be a relative path without . or ..")
  .refine(
    (value) => value.split("/").length > 2 && value.split("/", 2).every((part) => part !== "" && !/[*?[\]{}!]/.test(part)),
    "must start with two literal folders, such as packages/<name>/; a whole top-level folder belongs in root.entries",
  );

const rootNames = z.array(z.string().min(1)).exactOptional();

/** What may sit at the repository root besides the defaults, root files that may stay JavaScript, and narrow paths outside every root. */
export const rootSchema = z.strictObject({ entries: rootNames, jsExceptions: rootNames, allow: z.array(allowGlob).exactOptional() }).exactOptional();
