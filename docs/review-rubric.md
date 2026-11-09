# Review rubric

Score the branch on six dimensions, 0–2 each. This rubric complements the gates;
a score cannot override a failing check. Review against the requested outcome and
its acceptance criteria, using the actual diff and verification evidence.

| Dimension         | 0                                                 | 1                                                      | 2                                                           |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Correctness       | Requested behavior is missing or broken           | Behavior works with an important uncovered case        | Acceptance cases are implemented and covered                |
| Verification      | Claims without executed checks                    | Checks ran but the user-facing outcome was not checked | Commands, results and user-facing verification are recorded |
| Scope discipline  | Unrelated changes obscure the task                | One unrelated change remains                           | The diff serves only the requested scope                    |
| Reliability       | Unit tests depend on clock, randomness or network | Deterministic tests miss a relevant failure path       | Deterministic tests cover boundaries and failure paths      |
| Maintainability   | Architecture, naming or size rules are bent       | Rules hold but responsibility or naming is unclear     | Clear responsibilities, names, boundaries and sizes         |
| Handoff readiness | Outcome and remaining work are unclear            | Evidence or limitations are missing                    | Changes, checks, limitations and next steps are explicit    |

Accept at 10 or more with no zero; revise below 10; block on correctness zero
regardless of total. Report concrete findings with severity, location, impact and
suggested fix. State what was actually verified and which behavior still lacks
proof. Do not weaken guards or tests to raise the score.
