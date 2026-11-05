---
name: test-failures-only
description: |
  Run a test suite and return ONLY the failing tests with condensed
  tracebacks. If every test passes, return one line. Supports pytest
  (Python), jest / vitest (JS/TS), and go test out of the box; falls
  back to a generic FAIL/ERROR line filter for other runners.
---

# test-failures-only

A **Markdown-only** skill — no Python, no scripts. You (Claude) run the test
command via the Bash tool with output redirected to a log file, then extract
only the failures using `grep`/`sed` plus framework-specific knowledge.

## When to invoke

Invoke `test-failures-only` instead of running the test command directly when:

- You need to know which tests fail and why, but not what passed.
- The test suite is large (>50 tests) and the verbose output would dominate
  the conversation.
- The user asks "are tests passing?" / "what's failing?" / "run the tests".

Do NOT invoke when:

- The user specifically asks to see all test output (use the run-quiet skill
  with `no_trim=true` instead).
- You need to debug a single specific test (run that test directly).
- The command is something other than a test runner.

## Framework detection

Look at the command. Match in this order:

| Match in command | Framework |
|------------------|-----------|
| `pytest` (anywhere) | `pytest` |
| `jest` (anywhere) | `jest` |
| `vitest` (anywhere) | `vitest` |
| `go test` | `go` |
| anything else | `generic` |

The user can override with a `framework=<name>` argument.

## Flag injection (only when the user did not already pass them)

| Framework | Inject | Rationale |
|-----------|--------|-----------|
| pytest | `--tb=line` (only if no other `--tb` flag) | Compact one-line tracebacks. |
| pytest | `-q` (only if no `-v` or `-q` already) | Quieter output. |
| jest / vitest | nothing | They are quiet by default. |
| go test | `-json` (only if not already present) | Structured failures. |

## How to run

### Step 1 — pick a log path

```bash
mkdir -p .claude/test-logs
LOG=".claude/test-logs/$(date -u +%Y%m%d-%H%M%S)-<framework>.log"
```

### Step 2 — run the test command, redirect everything to the log

```bash
{ <COMMAND_WITH_INJECTED_FLAGS> ; } >"$LOG" 2>&1
EXIT=$?
```

Capture `$EXIT` and the elapsed time.

### Step 3 — parse the log per framework

Use the rules below to extract `failures` (list of `{name, detail}`),
plus the totals (`passed`, `failed`, `skipped`, `duration`).

#### pytest

- Final summary line example:
  `===== 3 failed, 174 passed, 2 skipped in 4.21s =====`
  Extract counts and duration from this.
- Each failure with `--tb=line` looks like:
  ```
  FAILED tests/test_users.py::test_create - AssertionError: expected 200, got 500
  ```
  Use `grep -E '^FAILED ' "$LOG"`. The test name is everything between
  `FAILED ` and ` - ` (or end of line); the detail is everything after ` - `.

#### jest / vitest

- Summary line: `Tests: 3 failed, 174 passed, 177 total` (and a separate
  `Time:` line).
- Failures: blocks starting with `  ● <test full name>` (a bullet `●` then
  the test name). The next few non-empty indented lines are the assertion
  detail. Use `grep -nE '^\s*●\s' "$LOG"` for names; read 1-3 lines after
  each match for detail.

#### go test (`-json`)

- Each line is a JSON event: `{"Time": "...", "Action": "...", "Test": "...", "Package": "...", "Output": "..."}`.
- Failure events: `Action == "fail"` and `Test` non-empty.
- For each failed test, gather `Output` events for that `Package`/`Test`
  combination; concatenate non-empty `Output` strings as detail.
- Final summary: count `Action == "pass"` / `"fail"` / `"skip"` with
  non-empty `Test`. Duration from `Elapsed` on the top-level package events.

#### generic fallback

- Find any line matching `(FAIL|ERROR|FAILED)` (case-sensitive).
- Use the entire matched line as the failure name; no separate detail.
- Totals: leave as unknown; just report a single line.

### Step 4 — strip ANSI escapes

Before printing any line that came from the log, strip color codes:

```bash
sed 's/\x1B\[[0-9;]*[a-zA-Z]//g'
```

### Step 5 — render the output

#### All-pass run

```
$ <command>
OK — <passed> passed[, <skipped> skipped] in <duration>  •  log: .claude/test-logs/<file>
```

#### Failing run

```
$ <command>
FAIL — <failed> failed, <passed> passed[, <skipped> skipped] in <duration>
log: .claude/test-logs/<file>

✗ <failure name 1>
    <detail line 1>
    <detail line 2>

✗ <failure name 2>
    <detail>
…
```

Cap the list at `max=N` failures (default 20). If more, append:
`… (+<extra> more — see log)`.

If `notrace=true` was passed, print only the failure names (no detail block).

#### Crash / unparseable run

If the framework parser cannot find any failures BUT the exit code is
non-zero, fall back to:

```
$ <command>
EXIT <code> — could not parse <framework> output
log: .claude/test-logs/<file>

tail (20):
  <last 20 lines of the log>
```

## Supported arguments (Claude maps these from natural language)

| Argument | Default | Purpose |
|----------|---------|---------|
| `root=<path>` | cwd / repo root | Working directory; logs under `<root>/.claude/test-logs/`. |
| `framework=<name>` | auto | Force a parser (`pytest`, `jest`, `vitest`, `go`, `generic`). |
| `max=N` | `20` | Cap on failures shown. |
| `notrace=true` | off | Show only failing test names, no traceback snippet. |

## Notes

- Logs accumulate under `.claude/test-logs/`. Put `.claude/` in the project's
  `.gitignore`.
- Auto-injected flags are best-effort. If the user already passes a custom
  reporter / output flag, respect it and don't inject.
- For Go: needs `-json`. The output looks intimidating but each line is a
  small JSON object — easy to filter with `grep '"Action":"fail"'`.
- For non-standard runners, the `generic` mode is intentionally crude. It
  gives you something rather than nothing.
