import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

// Git hooks export repository selectors; tests must resolve their disposable repositories instead.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_PREFIX"]) {
  delete process.env[name];
}

export interface RepoFixture {
  root: string;
  write(file: string, text: string): void;
  read(file: string): string;
  remove(file: string): void;
  git(...args: string[]): string;
}

const parents = new Set<string>();
afterEach(() => {
  for (const parent of parents) {
    fs.rmSync(parent, { recursive: true, force: true });
    parents.delete(parent);
  }
});

export function makeRepo(files: Record<string, string> = {}): RepoFixture {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "next harness-"));
  parents.add(parent);
  const root = path.join(parent, "repo");
  const hooks = path.join(parent, "no-hooks");
  fs.mkdirSync(root);
  fs.mkdirSync(hooks);
  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(parent, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" },
    });
  const target = (file: string): string => {
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${file} escapes the repository`);
    return resolved;
  };
  const write = (file: string, text: string): void => {
    const destination = target(file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "core.hooksPath", hooks);
  for (const [file, text] of Object.entries(files)) write(file, text);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "Fixture");
  return {
    root,
    write,
    read: (file) => fs.readFileSync(target(file), "utf8"),
    remove: (file) => fs.rmSync(target(file), { force: true }),
    git,
  };
}
