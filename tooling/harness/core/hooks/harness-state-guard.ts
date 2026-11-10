/** `.git/harness` or `.git\harness` as a path of its own: not `tools.git/harness`, not `.git/harness-notes.md`. */
const STATE_PATH = /(?<![\w.-])\.git[/\\]+harness(?![\w.-])/;
/** `.git` and `harness` joined as quoted parts, as a script builds the path: `'.git','harness'`, `".git" + "harness"`. */
const QUOTED_JOIN = /(["'])\.git\1\s*[,+]\s*(["'])harness\2/;
const GIT_PATH = /--git-path[=\s]+harness(?![\w.-])/;
const QUOTED = /(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
/** An interpreter's code flag: what follows it runs. */
const CODE_FLAG = /(?:^|\s)(?:-c|-e|--eval)(?:=|\s+)$/;

/**
 * Prose a command only carries, such as a commit message or a chat line: a quoted string with whitespace, unless it is
 * code for an interpreter (after -c, -e or --eval) or holds a command substitution.
 */
function withoutProse(command: string): string {
  return command.replace(QUOTED, (quoted: string, _quote: string, body: string, offset: number) => {
    const code = CODE_FLAG.test(command.slice(0, offset)) || body.includes("$(") || body.includes("`");
    return !code && /\s/.test(body) ? '""' : quoted;
  });
}

/** Whether a shell command names the harness's state folder; reading it counts too, since the state is the harness's own. */
export function namesHarnessState(command: string): boolean {
  const text = withoutProse(command);
  const unquoted = text.replace(/["'`]/g, "");
  return QUOTED_JOIN.test(text) || [text, unquoted].some((form) => STATE_PATH.test(form) || GIT_PATH.test(form));
}
