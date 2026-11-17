import { join, posix } from "node:path";
import { SERVER_CONDITION, serverPackages, withoutServerCondition } from "../../../shapes/node/server-condition.ts";
import { NODE_LAYOUT } from "../../../shapes/node/source-rules.ts";
import { resolveHarness } from "../../path-check.ts";
import type { Finding } from "../finding.ts";

/**
 * The `server-condition` rule: a node-service that depends on a package with a src/server.ts starts Node with the
 * react-server condition, in its package scripts and its Dockerfile. That entry imports "server-only", which throws
 * under plain Node, and the service's tests would not show it: they never start the service.
 */
export function auditServerCondition(root: string): Finding[] {
  const { workspaces } = resolveHarness(root);
  return workspaces
    .filter((workspace) => workspace.shape === "node-service")
    .flatMap((workspace): Finding[] => {
      const dir = join(root, workspace.path);
      const names = serverPackages(root, workspaces, dir).map(({ name }) => name);
      if (names.length === 0) return [];
      return withoutServerCondition(dir).map(({ file, where, line }) => ({
        rule: "server-condition",
        file: posix.join(workspace.path, file),
        ...(line === undefined ? {} : { line }),
        message: `${where} starts Node without ${SERVER_CONDITION}, and this service depends on ${names.join(", ")}, whose src/server.ts imports "server-only": plain Node throws on that import. Put ${SERVER_CONDITION} after node ${NODE_LAYOUT}`,
      }));
    });
}
