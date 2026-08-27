# pi-timeout-guard

A [pi](https://github.com/earendil-works/pi) extension that stops sessions and
sub-agents from **hanging forever** because the model emitted an unbounded
full-filesystem scan or a bash command with no timeout.

- **Blocks** clearly unbounded root scans: `find /`, `grep -r /`, `du /`,
  `rg /`, `ack /` (and the standalone `find` / `grep` tools when their path is
  the filesystem root `/`).
- **Injects a default timeout** (60s) into every `bash` tool call that omits one,
  so a runaway command is killed instead of wedging the session.

> Iron rule of this project: it only *adds* an extension. It never patches
> `pi-subagents` or the `pi` package source.

## Why

`pi`'s bash tool `timeout` is optional and has **no default** — a call with no
timeout can run until the heat death of the universe. `pi-subagents` only counts
turns, so a single stuck tool call never times out. A model that blurts
`find / -name '*.log'` (or `grep -rl secret /`) can therefore wedge the main
session *or* a default (non-isolated) sub-agent indefinitely. This extension is
the safety net.

## Install

From this directory (writes to `~/.pi/agent/settings.json`, loads globally —
including default sub-agents, since they auto-load global extensions):

```bash
pi install ./pi-timeout-guard
```

Try it for one run without installing:

```bash
pi -e ./pi-timeout-guard
```

Or install from git/npm once published:

```bash
pi install git:github.com/WinterSold1er/pi-timeout-guard
# pi install npm:pi-timeout-guard
```

## Verify it loads

```bash
# type-check against the real pi types (proves ExtensionAPI conformance)
npm run typecheck

# run the bundled self-checks (regex + timeout injection)
npm test

# prove the compiled extension is a loadable factory
node --input-type=module -e "import('./dist/index.js').then(m=>{if(typeof m.default!=='function')throw new Error('no factory');console.log('loadable factory OK')})"
```

Or load it inside pi and watch the guard fire:

```bash
pi -e ./pi-timeout-guard        # then ask the model to run `find /`
```

## Configuration

The only knob is the default bash timeout, externalized via environment variable
(no source edits needed):

| Variable | Default | Effect |
|----------|---------|--------|
| `PI_TIMEOUT_GUARD_SECONDS` | `60` | Default timeout (seconds) injected into bash calls that omit one. Must be a positive number to take effect. |

Everything else (the root-path blocklist, the scanner tool set, the 60s constant)
is an intentional, documented feature constant — see **Limitations** for the
deliberate narrowness.

## How the blocking works (conservative — prefer misses)

Detection is string-based and **narrow on purpose**: it only blocks when a
scanning tool (`find`, `du`, `grep`, `rg`, `ack`) is given the literal
filesystem root `/` as a path argument.

- `find /` → blocked · `find /home/you` → **allowed** (bounded)
- `find .` → allowed · `./find /` → allowed (not the `find` command)
- `grep -r /` → blocked · `grep -r /home/you` → **allowed** (bounded)
- `grep /` (no `-r`) → allowed (single-shot, just errors on a dir)
- `du /` → blocked · `ls /`, `cat /etc/passwd` → allowed (not walkers)

The standalone `find` / `grep` tools are blocked only when their `path` is `/`.

## Limitations / edges

- **Sub-agents that are `isolated`** do not inherit global extensions; install
the package into those agents' extension set separately.
- **"宁漏勿误杀"**: a scan rooted at `/home` (or any non-`/` path) is *not*
  blocked even though it could be slow — the guard only targets the literal
  root. Tighten the regex in `src/guard.ts` if you want broader coverage.
- Complex shell quoting / heredocs can defeat the simple tokenizer; a missed
dangerous command is allowed through (fail-open), never silently broken.
- The guard never *modifies* a blocked command — it refuses execution and
  returns a reason. The model can retry with a scoped path + explicit timeout.

## Develop

```bash
npm install          # pulls devDeps (typescript, @types/node, pi types)
npm run build        # tsc -> dist/
npm test             # node --test test/self-check.mjs
```

`src/guard.ts` is pure and dependency-free (unit-tested in plain Node);
`src/index.ts` is the pi wiring (the `tool_call` handler).

## License

MIT
