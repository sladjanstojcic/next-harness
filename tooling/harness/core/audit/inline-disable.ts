import { ts } from "../../tools/typescript.ts";
import type { Finding } from "./finding.ts";

const SUPPRESSION = /(?:eslint|oxlint)-disable(?:-next-line|-line)?|@ts-(?:ignore|expect-error|nocheck)\b/;

interface Comment {
  pos: number;
  text: string;
}

/** Every comment between tokens, once; text inside JSX is not a comment even when it starts with `//`. */
function commentsOf(source: ts.SourceFile): Comment[] {
  const found = new Map<number, Comment>();
  const jsxText: [number, number][] = [];
  const collect = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) found.set(range.pos, { pos: range.pos, text: source.text.slice(range.pos, range.end) });
  };
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxText.push([node.pos, node.end]);
    collect(ts.getLeadingCommentRanges(source.text, node.pos));
    collect(ts.getTrailingCommentRanges(source.text, node.end));
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return [...found.values()].filter(({ pos }) => !jsxText.some(([start, end]) => pos >= start && pos < end)).sort((a, b) => a.pos - b.pos);
}

/** One finding per comment that disables a lint rule or a type check; `message` may name the comment with {directive}. */
export function inlineDisableFindings(file: string, source: ts.SourceFile, message: string): Finding[] {
  return commentsOf(source).flatMap(({ pos, text }) => {
    const directive = SUPPRESSION.exec(text)?.[0];
    if (directive === undefined) return [];
    const line = source.getLineAndCharacterOfPosition(pos).line + 1;
    return [{ rule: "inline-disable", file, line, message: message.replace("{directive}", directive) }];
  });
}
