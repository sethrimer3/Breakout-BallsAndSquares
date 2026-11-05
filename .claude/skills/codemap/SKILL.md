---
name: codemap
description: |
  Generate a single CODEMAP.md at the repo root containing a filtered file
  tree, a one-line purpose for each source file, and exported top-level
  symbols (functions, classes, constants). Invoke at the start of a new
  conversation in an unfamiliar repo to avoid spending tokens on repeated
  Glob / Grep / Read exploration. Supports Python, TypeScript/JavaScript,
  and Go for symbol extraction; other files appear in the tree only.
disable-model-invocation: true
---

# codemap

A **Markdown-only** skill — no Python, no scripts. You (Claude) walk the
repo using `git ls-files` and the Glob tool, then use `grep` to extract
top-level symbols per language. The result is a single `CODEMAP.md` at the
repo root.

## When to invoke

Invoke `codemap` when ANY of these apply:

- This is a new conversation in a repository you have not explored yet.
- The user asks "where is X?" without giving a path.
- You are about to make 3+ `Glob` / `Grep` calls just to understand layout.
- The user explicitly types `/codemap` or asks to "regenerate the codemap".

Do NOT invoke when:

- A fresh `CODEMAP.md` already exists at the repo root and was generated today
  (read it instead).
- The task is scoped to one file whose path is already known.
- The repo is trivial (< 10 source files) — direct exploration is cheaper.

## Trade-off vs the old Python parser

The Markdown recipe uses `grep` patterns instead of AST parsing. That means:

- **Faster, no dependencies** — works anywhere `git` and `grep` are available.
- **Slightly less precise** — multi-line declarations, decorators changing
  visibility, or unusual formatting may produce false positives/negatives.
- **Good enough for navigation** — the map is a hint, not gospel. If a
  symbol isn't where the map says, fall back to `Grep` for the exact
  location.

## How to run

### Step 1 — list source files

```bash
git ls-files
```

This is the single best source of truth: it respects `.gitignore` and skips
junk like `node_modules`, `.venv`, `__pycache__`, etc. for free.

If the user passed `root=<subdir>`, filter to only files under `<subdir>/`.

If the repo has > 5000 files, abort and ask the user for a `root=<subdir>`.

### Step 2 — classify files by language

| Extension | Language |
|-----------|----------|
| `.py` | Python |
| `.ts`, `.tsx`, `.mts`, `.cts` | TypeScript |
| `.js`, `.jsx`, `.mjs`, `.cjs` | JavaScript |
| `.go` | Go |
| anything else | unknown — tree only, no symbol extraction |

### Step 3 — extract one-line purpose per file

For each source file, read just the first ~20 lines (use `head -n 20` or
`Read` with `limit: 20`) and pull a purpose from the first match:

- Python: triple-quoted string at top of file → its first line.
- TS/JS: leading `/**` JSDoc → first content line; else top single-line
  comment `// …` runs joined.
- Go: leading `// Package <name> …` comment → text after package name.
- Fallback: humanized filename (e.g. `auth_middleware.py` → "auth middleware").

Cap each purpose at ~80 characters.

### Step 4 — extract exported top-level symbols (per language, in parallel)

Run these `grep` commands as **parallel Bash calls**, one batch per language,
piping the results into a buffer Claude parses:

#### Python

```bash
grep -nE '^(class|def|async def) [A-Za-z_]' <file>
grep -nE '^[A-Z][A-Z0-9_]*\s*=' <file>
```

Skip symbols beginning with `_` (Python convention for private).

#### TypeScript / JavaScript

```bash
grep -nE '^export\s+(default\s+)?(async\s+)?(function|class|const|let|var|interface|type|enum)\s+[A-Za-z_]' <file>
grep -nE '^export\s+\{' <file>
```

For the `export { … }` case, capture the full braces block (may span lines —
use `grep -nA 5` and stop at the closing brace).

#### Go

```bash
grep -nE '^func\s+(\([^)]+\)\s+)?[A-Z][A-Za-z0-9_]*\s*\(' <file>
grep -nE '^type\s+[A-Z][A-Za-z0-9_]*\s' <file>
grep -nE '^(var|const)\s+[A-Z][A-Za-z0-9_]*\s' <file>
```

Go's convention: exported = uppercase-initial.

Cap symbols per file at `max=N` (default 30). For each symbol, record the
line number and a one-line signature (trim to first ~80 chars).

### Step 5 — write `CODEMAP.md`

Path: `<repo-root>/CODEMAP.md`. Overwrite if it exists.

```markdown
# CODEMAP

_Generated: <UTC timestamp>_

## Tree

```
<repo-name>/
├── src/
│   ├── api/
│   │   ├── auth.py
│   │   ├── users.py
│   │   └── __init__.py
│   └── auth/
│       └── jwt.py
├── tests/
│   └── test_users.py
└── README.md
```

(Render the tree as ASCII art. Show all files from `git ls-files`. Group
tests under a separate `## Tree (tests)` section unless `includetests=true`.)

## Files

### src/api/auth.py
_auth middleware — validates JWTs on every request_
- L12 `class AuthMiddleware:`
- L34 `def verify_jwt(token):`
- L60 `JWT_ALGORITHM = "HS256"`

### src/api/users.py
_user CRUD endpoints_
- L8  `class UserCreate(BaseModel):`
- L20 `def create_user(payload):`
- …

(Sort by path. Skip files with no symbols when listing under `## Files`;
they still appear in the tree.)
```

### Step 6 — confirm

Print one line to the user:

```
codemap: wrote CODEMAP.md (<N> files, <M> with symbols)
```

## Supported arguments

| Argument | Default | Purpose |
|----------|---------|---------|
| `root=<subdir>` | repo root | Index only this subtree (useful in monorepos). |
| `max=N` | `30` | Cap symbols listed per file. |
| `includetests=true` | off | Include test files in the main `## Files` section instead of a separate group. |
| `refresh=true` | off | (no-op in the Markdown version — full regen is the only mode) |

## Notes

- `CODEMAP.md` is a derived artifact — add it to `.gitignore` if you don't
  want it committed (some teams prefer to commit it as repo documentation;
  either choice is fine).
- The Markdown recipe does not maintain a cache. Regeneration is cheap
  because most of the work is parallel `grep`, and Claude only needs to read
  one short response per file.
- Parser errors on individual files are non-fatal: if a `grep` fails, the
  file appears in the tree without symbol detail.
- If a symbol you need is not in the map, fall back to `Grep` for the
  precise location. The map is a navigation aid, not an exhaustive index.
