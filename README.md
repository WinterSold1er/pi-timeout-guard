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

See the full README in the committed tree (pushed immediately after this seed).
