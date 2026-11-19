import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { stateDir } from "../state/state-file.ts";

const exec = promisify(execFile);

/** The project's supabase folder, and each app env name with the `supabase status` key that fills it. */
export interface E2eDatabaseConfig {
  supabase: string;
  env: Record<string, string>;
}

export interface E2eDatabase {
  env: Record<string, string>;
  stop(): Promise<void>;
}

/** Postgres always runs; Kong and PostgREST serve the REST API an app reads. Everything else stays off. */
const EXCLUDED = ["gotrue", "realtime", "storage-api", "imgproxy", "mailpit", "postgres-meta", "studio", "edge-runtime", "logflare", "vector", "supavisor"];
const PORT_LINE = /^([ \t]*(?:port|shadow_port|smtp_port|pop3_port|inspector_port)[ \t]*=[ \t]*)\d+/gm;
const CLI_ENV = ["PATH", "HOME", "USER", "LANG", "TMPDIR", "XDG_RUNTIME_DIR", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT"];
const IGNORED = new Set([".temp", ".branches"]);

export const portCount = (toml: string): number => [...toml.matchAll(PORT_LINE)].length;

/** The test stack's config: its own project id and ports, and the API on its local address, so it never meets the dev stack. */
export function e2eSupabaseConfig(toml: string, ports: readonly number[]): string {
  if (ports.length < portCount(toml)) throw new Error(`the test stack needs ${portCount(toml)} ports, got ${ports.length}`);
  let next = 0;
  return toml
    .replace(/^([ \t]*project_id[ \t]*=[ \t]*)"([^"]*)"/m, (_line, head: string, id: string) => `${head}"${id}-e2e"`)
    .replace(/^[ \t]*external_url[ \t]*=.*\n?/gm, "")
    .replace(PORT_LINE, (_line, head: string) => `${head}${ports[next++] ?? 0}`);
}

/** The app's env, each name filled from the `supabase status --output json` key the project maps it to. */
export function e2eEnv(status: unknown, names: Record<string, string>): Record<string, string> {
  const values: Record<string, unknown> = typeof status === "object" && status !== null ? { ...status } : {};
  return Object.fromEntries(
    Object.entries(names).map(([name, key]) => {
      const value = values[key];
      if (typeof value !== "string" || value === "") throw new Error(`supabase status gives no ${key} for ${name}`);
      return [name, value];
    }),
  );
}

async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<net.Server>((resolve, reject) => {
          const server = net.createServer();
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
  );
  const ports = servers.map((server) => {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no free port");
    return address.port;
  });
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}

function cliEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (!CLI_ENV.includes(key)) delete env[key];
  return env;
}

/**
 * Starts a fresh Supabase stack from a copy of the project's supabase folder, with its migrations and seed, for one run of
 * the browser tests. Its ports come from the system's free range, its project id ends in "-e2e", and stop() removes it
 * with its data.
 */
export async function startE2eDatabase(root: string, config: E2eDatabaseConfig): Promise<E2eDatabase> {
  const source = path.join(root, config.supabase);
  const toml = fs.readFileSync(path.join(source, "config.toml"), "utf8");
  const workdir = fs.mkdtempSync(path.join(stateDir(root), "e2e-database-"));
  const cli = async (args: string[], timeout: number): Promise<string> => {
    try {
      const { stdout } = await exec("supabase", [...args, "--workdir", workdir], { cwd: workdir, env: cliEnvironment(), timeout, maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      const output = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
      const tail = output.trim().split(/\r?\n/).slice(-20).join("\n");
      throw new Error(`supabase ${args[0] ?? ""} failed for the browser test database${tail === "" ? "" : `:\n${tail}`}`, { cause: error });
    }
  };
  const stop = async (): Promise<void> => {
    await cli(["stop", "--no-backup"], 120_000).catch(() => undefined);
    fs.rmSync(workdir, { recursive: true, force: true });
  };
  try {
    const folder = path.join(workdir, "supabase");
    fs.cpSync(source, folder, { recursive: true, filter: (file) => !IGNORED.has(path.relative(source, file).split(path.sep)[0] ?? "") });
    fs.writeFileSync(path.join(folder, "config.toml"), e2eSupabaseConfig(toml, await freePorts(portCount(toml))));
    // A stack an interrupted run left behind has the same project id; it goes first.
    await cli(["stop", "--no-backup"], 120_000).catch(() => undefined);
    await cli(["start", "--exclude", EXCLUDED.join(",")], 600_000);
    return { env: e2eEnv(JSON.parse(await cli(["status", "--output", "json"], 60_000)), config.env), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
