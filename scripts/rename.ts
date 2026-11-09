import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const optionsSchema = z.object({
  name: z.string().regex(/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/),
  port: z.number().int().min(1).max(65535),
  title: z
    .string()
    .min(1)
    .regex(/^[^\r\n]+$/),
});
const packageSchema = z.object({ scripts: z.record(z.string(), z.string()) }).passthrough();

// Validate, then keep the parsed object itself so package.json keeps its key order.
function isManifest(value: unknown): value is z.infer<typeof packageSchema> {
  return packageSchema.safeParse(value).success;
}

export function rename(root: string, options: { name: string; port: number; title: string }): void {
  const { name, port, title } = optionsSchema.parse(options);
  const packageFile = path.join(root, "package.json");
  const layoutFile = path.join(root, "src/app/layout.tsx");
  const readmeFile = path.join(root, "README.md");
  const parsed: unknown = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  if (!isManifest(parsed)) throw new Error("Put a scripts object in package.json before renaming.");
  const manifest = parsed;
  const layout = fs.readFileSync(layoutFile, "utf8");
  const readme = fs.readFileSync(readmeFile, "utf8");
  const titlePattern = /(export\s+const\s+metadata\s*(?::\s*Metadata\s*)?=\s*\{[^}]*?\btitle\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/;
  const descriptionPattern = /(export\s+const\s+metadata\s*(?::\s*Metadata\s*)?=\s*\{[^}]*?\bdescription\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/;
  if (!titlePattern.test(layout)) throw new Error("Put a string metadata.title in src/app/layout.tsx before renaming.");
  if (!descriptionPattern.test(layout)) throw new Error("Put a string metadata.description in src/app/layout.tsx before renaming.");
  if (!/^# .+$/m.test(readme)) throw new Error("Put the project heading in README.md before renaming.");
  manifest.name = name;
  manifest.scripts.dev = `next dev -p ${port}`;
  fs.writeFileSync(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    layoutFile,
    layout
      .replace(titlePattern, (_match: string, prefix: string) => `${prefix}${JSON.stringify(title)}`)
      .replace(descriptionPattern, (_match: string, prefix: string) => `${prefix}${JSON.stringify(title)}`),
  );
  fs.writeFileSync(
    readmeFile,
    readme.replace(/^# .+$/m, () => `# ${title}`),
  );
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { name: { type: "string" }, port: { type: "string" }, title: { type: "string" } } });
  rename(process.cwd(), optionsSchema.parse({ ...values, port: Number(values.port) }));
}
