import { describe, expect, it } from "vitest";
import { patchPaths } from "./patch-paths.ts";

const patch = (body: string): string => `*** Begin Patch\n${body}\n*** End Patch`;

describe("patchPaths", () => {
  it("keeps operations and both move ends, so only destinations are writes", () => {
    expect(
      patchPaths(
        patch(
          [
            "*** Add File: new.ts",
            "+new",
            "*** Update File: old.ts",
            "@@",
            "-old",
            "+new",
            "*** Delete File: gone.ts",
            "*** Update File: source.ts",
            "*** Move to: target.ts",
            "@@",
            " x",
          ].join("\n"),
        ),
      ),
    ).toEqual([
      { path: "new.ts", op: "add" },
      { path: "old.ts", op: "update" },
      { path: "gone.ts", op: "delete" },
      { path: "source.ts", op: "move-from" },
      { path: "target.ts", op: "move-to" },
    ]);
  });

  // Grammar: https://github.com/openai/codex/blob/main/codex-rs/apply-patch/src/parser.rs
  it("accepts an environment ID without treating it as a path", () => {
    expect(patchPaths(patch("*** Environment ID: x\n*** Add File: x.ts\n+x"))).toEqual([{ path: "x.ts", op: "add" }]);
  });

  it("accepts whitespace around markers and CRLF", () => {
    expect(patchPaths(" \t*** Begin Patch \r\n  *** Update File: x.ts \r\n  *** Move to: y.ts \r\n@@\r\n x\r\n *** End Patch \r\n")).toEqual([
      { path: "x.ts", op: "move-from" },
      { path: "y.ts", op: "move-to" },
    ]);
  });

  it.each(["<<EOF", "<<'EOF'", '<<"EOF"'])("accepts the documented heredoc wrapper %s", (wrapper) => {
    expect(patchPaths(`${wrapper}\n${patch("*** Delete File: x.ts")}\nEOF\n`)).toEqual([{ path: "x.ts", op: "delete" }]);
  });

  it("does not parse added or removed marker-like content as headers", () => {
    expect(patchPaths(patch("*** Update File: x.ts\n@@\n-*** Delete File: .env\n+*** Add File: .env\n*** End of File"))).toEqual([
      { path: "x.ts", op: "update" },
    ]);
  });

  it("keeps leading whitespace in Update body context, including marker-like lines", () => {
    expect(patchPaths(patch("*** Update File: x.ts\n@@\n *** Delete File: .env\n-old\n+new"))).toEqual([{ path: "x.ts", op: "update" }]);
  });

  it.each([
    "",
    "*** Begin Patch\n*** End Patch",
    "*** Add File: x.ts\n+x",
    "*** Begin Patch\n*** Delete File: x.ts",
    patch("*** Add File: \n+x"),
    patch("*** Delete File: x\0.ts"),
    patch("*** Move to: x.ts"),
    patch("*** Add File: x.ts\n*** Move to: y.ts"),
    patch("*** Update File: x.ts\n@@\n x\n*** Move to: y.ts"),
    patch("*** Update File: x.ts\n*** Move to: y.ts\n*** Move to: z.ts"),
    patch("content\n*** Add File: x.ts\n+x"),
    patch("*** Unknown File: x.ts"),
    patch("*** Delete File: x.ts\n*** Environment ID: x"),
    patch("*** Environment ID: x\n*** Environment ID: y\n*** Delete File: x.ts"),
    `<<"EOF'\n${patch("*** Delete File: x.ts")}\nEOF`,
  ])("rejects a malformed patch %#", (value) => {
    expect(() => patchPaths(value)).toThrow();
  });
});
