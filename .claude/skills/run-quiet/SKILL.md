---
name: run-quiet
description: |
  Wrap a verbose command (pytest, npm run build, terraform plan, etc.).
  The full output is saved to a log file; only the exit code, the matched
  error/warning lines, and the last few lines are returned. Read the log
  on demand if more context is needed. Use instead of running verbose
  commands directly when their output is large or noisy.
---

# run-quiet

A **Markdown-only** skill — no Python, no scripts. You (Claude) run the
verbose command directly via the Bash tool with output redirected to a log
file, then use `grep`/`head`/`tail` against the log to build a short digest.

## When to invoke

Invoke `run-quiet` when ANY of these apply:

- The command's output is likely to be over ~200 lines (build tools, test
  suites, `terraform plan`, infrastructure scans, package install logs, etc.).
- You only need to know whether the command succeeded and, if not, why.
- The command is verbose by design (`-v`, `--verbose`) but you want a digest.

Do NOT invoke when:

- The command is interactive (asks for input).
- The output IS the answer the user wants (e.g. `cat`, `git show`, `jq`).
- The command is short and you need every line (e.g. `git status --porcelain`).

## Defaults

| Setting | Default | Override with |
|---------|---------|---------------|
| Log directory | `<repo-root>/.claude/run-logs/` | `--root <path>` argument |
| Max error lines shown | 30 | `max=N` argument |
| Tail lines shown | 10 | `tail=N` argument |
| Head lines shown | 0 | `head=N` argument |
| Timeout | none | `timeout=Ns` argument |

If you can't find a repo root (`.git` not in any parent), use the current
working directory.

## How to run

### Step 1 — pick a log path

```bash
mkdir -p .claude/run-logs
LOG=".claude/run-logs/$(date -u +%Y%m%d-%H%M%S)-$$.log"
```

### Step 2 — run the command, redirect everything to the log, capture exit code

Use this single Bash call (works in Git Bash on Windows and any POSIX shell):

```bash
{ <COMMAND> ; echo "__RUN_QUIET_EXIT__=$?"; } >"$LOG" 2>&1
```

Or, if you prefer the value in a variable (still one Bash call):

```bash
<COMMAND> >"$LOG" 2>&1; echo "exit=$?"
```

For PowerShell users:

```powershell
& <COMMAND> *>&1 | Tee-Object -FilePath $LOG | Out-Null
$exit = $LASTEXITCODE
```

Read the exit code from the output. If the user passed `timeout=Ns`, wrap
the command with `timeout Ns <COMMAND>` (Unix) or use
`Start-Process -Wait -TimeoutSec N` (PowerShell). On timeout, append a
literal line `run-quiet: killed after Ns timeout` to the log.

### Step 3 — gather the digest pieces in parallel

Run these in a single parallel Bash batch against the log file:

| Command | Yields |
|---------|--------|
| `wc -l "$LOG"` | Total line count. |
| `head -n <head_n> "$LOG"` | Head lines (skip if `head_n` is 0). |
| `tail -n <tail_n> "$LOG"` | Tail lines. |
| `grep -nE '<error-regex>' "$LOG" \| head -n <max+20>` | Candidate error/warning lines. |

### Error regex

Use this extended-regex (POSIX ERE) that matches both generic patterns and
framework-specific signals:

```
\b(error|errno|exception|traceback|failed|failure|panic|fatal)\b|\bWARN(ING)?\b|^FAILED |^ERROR |^FAIL |^---[[:space:]]+FAIL:|^[[:space:]]*●[[:space:]]|^E[[:space:]]{2}
```

It's case-insensitive — pass `-i` to `grep`.

Strip ANSI escape codes from the error lines before printing:

```bash
sed 's/\x1B\[[0-9;]*[a-zA-Z]//g'
```

Drop any candidate line that also appears in the head/tail slices (to avoid
duplication). Cap the list at `max` (default 30); if there are more, append
`… (+N more — see log)`.

## Output format

### Clean run (exit 0 and no error lines matched)

```
$ <command>
exit: 0 (in <secs>s)  •  log: .claude/run-logs/<file> (<N> lines)
clean — last line: "<last non-empty line of log>"
```

### Failing run (or non-zero exit, or matched errors)

```
$ <command>
exit: <code> (in <secs>s)
log:  .claude/run-logs/<file> (<N> lines)

head (<N>):
  <line>
  …

errors (<count>[, truncated]):
  <line>
  <line>
  … (+<extra> more — see log)

tail (<N>):
  <line>
  …
```

Omit the `head` section if `head_n` is 0 or empty.
Omit the `errors` section if no errors matched.

## When to fall back to no-trim mode

If the user passes `no_trim=true` (or the digest looks suspiciously empty for
a non-zero exit), print the entire log contents instead of the digest,
followed by the standard `exit: ... log: ...` line.

## Notes

- Logs accumulate in `.claude/run-logs/`. Add that directory (or just
  `.claude/`) to the project's `.gitignore`.
- The error regex catches generic patterns + a few framework-specific ones
  (pytest `FAILED`, jest `FAIL` / `●`, Go `--- FAIL:`). False negatives are
  possible — if the digest looks too clean for a failing exit code, re-run
  with `no_trim=true` or `grep` the log yourself.
- On Windows + PowerShell-only environments, prefer the PowerShell snippet
  above. On Windows + Git Bash (Claude Code's default), the Bash recipe
  works as-is.
- The full log path is shown — if you need more context, read the log with
  the Read tool.
