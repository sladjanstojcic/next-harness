import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Resolve the nearest existing ancestor, including symlinks and macOS /var aliases. */
export function realPath(target: string): string {
  let existing = target;
  const rest: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return target;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync.native(existing), ...rest);
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function shellWords(segment: string): string[] {
  return [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function expandHome(word: string): string {
  const home = os.homedir();
  if (word === "~" || word === "$HOME" || word === "${HOME}") return home;
  return word.replace(/^(~|\$HOME|\$\{HOME\})\//, `${home}/`);
}

const baseName = (word: string): string => word.split("/").at(-1) ?? word;
const notAPath = new Set(["{}", "\\;", ";", "+"]);
const isTarget = (word: string): boolean => !word.startsWith("-") && !notAPath.has(word);

function rmTargets(tokens: string[]): string[] {
  const rm = tokens.findIndex((word) => baseName(word) === "rm");
  return rm < 0 ? [] : tokens.slice(rm + 1).filter(isTarget);
}

function findStarts(tokens: string[]): string[] {
  const find = tokens.findIndex((word) => baseName(word) === "find");
  const deletes = tokens.includes("-delete") || tokens.some((word, at) => /^-exec(dir)?$/.test(word) && baseName(tokens[at + 1] ?? "") === "rm");
  if (find < 0 || !deletes) return [];
  const starts: string[] = [];
  for (const word of tokens.slice(find + 1)) {
    if (!isTarget(word) || word === "(" || word === "!") break;
    starts.push(word);
  }
  return starts;
}

/** Ported target inspection, not a shell interpreter; no command is executed. */
export function removesOutside(command: string, cwd: string, repositoryRoot: string): boolean {
  const root = realPath(repositoryRoot);
  const gitDir = path.join(root, ".git");
  const resolve = (token: string): string => realPath(path.resolve(cwd, expandHome(token)));
  const reaches = (target: string): boolean => !isInside(root, target) || isInside(gitDir, target);
  for (const segment of command.split(/[;&|]+/)) {
    const tokens = shellWords(segment);
    if (rmTargets(tokens).some((token) => reaches(resolve(token)) || resolve(token) === root)) return true;
    const filtered = tokens.some((token) => ["-name", "-path", "-iname"].includes(token));
    if (findStarts(tokens).some((token) => reaches(resolve(token)) || (!filtered && resolve(token) === root))) return true;
  }
  return false;
}
