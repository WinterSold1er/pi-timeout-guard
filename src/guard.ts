// Pure, dependency-free guard logic for pi-timeout-guard.
//
// No runtime imports: this module is unit-tested in plain Node and can be
// bundled without pulling in the pi runtime. The pi wiring lives in index.ts.

export const DEFAULT_TIMEOUT_SECONDS = 60;
export const ROOT_PATH = "/";

// Tools whose unbounded root scan can hang a session forever.
// `needsRecursiveFlag: true` => only dangerous when a recursive flag is present
// (e.g. `grep -r /`); grep is NOT recursive by default. rg/ack are recursive
// by default, so no flag is required. find/du always walk.
const SCANNER_TOOLS: Record<string, { needsRecursiveFlag: boolean }> = {
  find: { needsRecursiveFlag: false },
  du: { needsRecursiveFlag: false },
  grep: { needsRecursiveFlag: true },
  rg: { needsRecursiveFlag: false },
  ack: { needsRecursiveFlag: false },
};

const WRAPPER_WORDS = new Set(["sudo", "env", "time", "command", "nohup", "nice"]);

// Flags that consume one following argument, so the value token after them
// must also be skipped (e.g. `sudo -u root`, `nice -n 19`, `env -C /dir`).
// Without this, the value (`root`, `19`) would be mistaken for the tool name
// and a real scanner like `find` right after it would be missed.
const FLAG_WITH_ARG = new Set(["-u", "-g", "-D", "-R", "-n", "-C", "-S", "-o"]);

export interface GuardVerdict {
  block: boolean;
  reason?: string;
}

function splitStatements(cmd: string): string[] {
  // Strip heredoc bodies BEFORE splitting so literal data inside <<EOF ... EOF
  // is never treated as a command. The `cat > f <<'EOF'\nfind /\nEOF` case must
  // NOT be blocked; the body is data, not an executed statement. We keep the
  // opening command line but drop everything from the terminator onward.
  const cleaned = stripHeredocs(cmd);
  return cleaned
    .split(/;|\|\||&&|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// A heredoc body is EXECUTED (not mere data) when either:
//  (a) the opener statement pipes its output into a shell interpreter
//      (e.g. `cat <<EOF | bash`), or
//  (b) the first real command word is a shell reading the body inline
//      (e.g. `bash <<'EOF'`, `sudo sh <<EOF`) without a `-c` external string.
// Execution-form bodies must be kept so their commands are analyzed; all
// other heredocs (file writes, here-strings fed to grep/cat, etc.) are data
// and their bodies must be stripped to avoid false positives.
const SHELL_WORDS = new Set(["bash", "sh", "zsh", "ksh"]);

function firstCommandWord(line: string): string {
  const tokens = tokenize(line);
  let j = 0;
  while (j < tokens.length) {
    const t = stripShellMeta(tokens[j]);
    if (
      WRAPPER_WORDS.has(t) ||
      t.startsWith("-") ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)
    ) {
      j++;
      continue;
    }
    return t;
  }
  return "";
}

function isHeredocExecutionForm(line: string): boolean {
  // (a) pipe to a shell interpreter anywhere in the statement
  if (/\|\s*\b(ba)?sh\b|\|\s*\bzsh\b|\|\s*\bksh\b/.test(line)) return true;
  // (b) the command word is a shell reading the body, with no -c string
  const fc = firstCommandWord(line);
  if (SHELL_WORDS.has(fc) && /<<-?/.test(line) && !/-c\b/.test(line)) return true;
  return false;
}

// Remove heredoc/here-string bodies so their literal contents are not analyzed
// as shell commands. For `<<`/`<<-` the body spans subsequent lines up to a
// line that is exactly the terminator word; for `<<<` (here-string) the data
// is the rest of the same line, which we truncate away.
function stripHeredocs(cmd: string): string {
  const lines = cmd.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heredoc = line.match(/<<-?\s*['\"]?([A-Za-z0-9_]+)['\"]?/);
    if (heredoc) {
      const term = heredoc[1];
      out.push(line); // keep the opening command; trailing <<TERM is inert for analysis
      i++;
      if (isHeredocExecutionForm(line)) {
        // Body is executed: keep each body line so its commands are analyzed.
        while (i < lines.length && lines[i].trim() !== term) {
          out.push(lines[i]);
          i++;
        }
      } else {
        // Body is data: drop it entirely.
        while (i < lines.length && lines[i].trim() !== term) i++;
      }
      i++; // consume the terminator line itself
      continue;
    }
    if (/<<</.test(line)) {
      // here-string: command is the part BEFORE <<<; data after is literal
      out.push(line.slice(0, line.indexOf("<<<")).trim());
      i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

function tokenize(stmt: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stmt))) tokens.push(m[1] ?? m[2] ?? m[3]!);
  return tokens;
}

// Strip leading shell metacharacters but KEEP ./ and / so that
// `./find` is NOT mistaken for the `find` command, while `(find` is.
function stripShellMeta(tok: string): string {
  return tok.replace(/^[;|&()<>]*/, "");
}

function toolNameOf(tok: string): string | null {
  const t = stripShellMeta(tok);
  // Bare command name, or an absolute path to the binary (e.g. /usr/bin/find).
  // A relative path like ./find must NOT match.
  if (t === "find" || (t.startsWith("/") && t.endsWith("/find"))) return "find";
  if (t === "du" || (t.startsWith("/") && t.endsWith("/du"))) return "du";
  if (t === "grep" || (t.startsWith("/") && t.endsWith("/grep"))) return "grep";
  if (t === "rg" || (t.startsWith("/") && t.endsWith("/rg"))) return "rg";
  if (t === "ack" || (t.startsWith("/") && t.endsWith("/ack"))) return "ack";
  return null;
}

function isRootPath(p: string): boolean {
  return p === ROOT_PATH || p === "//";
}

function hasRecursiveFlag(tokens: string[]): boolean {
  for (const t of tokens) {
    if (t.startsWith("-") && !t.startsWith("--")) {
      if (/[rR]/.test(t)) return true;
    } else if (t.startsWith("--")) {
      if (t === "--recursive" || t === "--all" || t === "--files-with-matches") return true;
    }
  }
  return false;
}

/**
 * Analyze a raw bash command string for a full-filesystem scan rooted at `/`.
 * Conservative by design: prefer misses over false positives. Returns
 * `{ block: true, reason }` only for clearly unbounded root walks.
 */
export function analyzeBashCommand(command: string): GuardVerdict {
  try {
    for (const stmt of splitStatements(command)) {
      const tokens = tokenize(stmt);
      if (tokens.length === 0) continue;

      let i = 0;
      // Skip a leading chain of: wrapper words (sudo/env/...), `-`-prefixed
      // flags, and `KEY=VAL` assignments, plus the single value token after a
      // flag that consumes one (see FLAG_WITH_ARG). Stops at the first real
      // command word.
      while (i < tokens.length) {
        const t = stripShellMeta(tokens[i]);
        if (
          WRAPPER_WORDS.has(t) ||
          t.startsWith("-") ||
          /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)
        ) {
          // `command -v/-V/--version NAME` is a PATH query, not execution;
          // treat the rest of the statement as data (skip scanner).
          if (t === "command" && i + 1 < tokens.length) {
            const nxt = stripShellMeta(tokens[i + 1]);
            if (nxt === "-v" || nxt === "-V" || nxt === "--version" || nxt === "--help") {
              break; // exit skip-loop; statement is not a scanner
            }
          }
          i++;
          if (t.startsWith("-") && FLAG_WITH_ARG.has(t) && i < tokens.length) i++;
          continue;
        }
        break;
      }
      if (i >= tokens.length) continue;

      const tool = toolNameOf(tokens[i]);
      if (!tool) continue;

      const cfg = SCANNER_TOOLS[tool];
      const rest = tokens.slice(i + 1);
      const rootArg = rest.find((a) => isRootPath(a));
      if (!rootArg) continue;
      if (cfg.needsRecursiveFlag && !hasRecursiveFlag(rest)) continue;

      return {
        block: true,
        reason: `Blocked: '${tool}' rooted at filesystem '/' can hang the session indefinitely. Scope the path (a subdirectory) and/or set an explicit timeout.`,
      };
    }
    return { block: false };
  } catch {
    return { block: false }; // fail open: never block on a guard bug
  }
}

/**
 * Analyze the root `path` argument of the standalone find/grep tools.
 * Blocks only the literal filesystem root `/` (narrow, safe).
 */
export function analyzeToolPath(toolName: string, path?: string): GuardVerdict {
  try {
    const tool = toolName.toLowerCase();
    if (tool !== "find" && tool !== "grep" && tool !== "du" && tool !== "rg") {
      return { block: false };
    }
    if (path && isRootPath(path)) {
      return {
        block: true,
        reason: `Blocked: ${tool} path is filesystem root '/'. Scope to a subdirectory to avoid an unbounded walk.`,
      };
    }
    return { block: false };
  } catch {
    return { block: false };
  }
}

export interface BashInput {
  command: string;
  timeout?: number;
}

/**
 * Return input with a default timeout injected when one is missing or invalid.
 * A present, positive timeout is left untouched.
 */
export function injectBashTimeout(
  input: BashInput,
  defaultSeconds: number = DEFAULT_TIMEOUT_SECONDS,
): BashInput {
  if (typeof input.timeout === "number" && input.timeout > 0) return input;
  return { ...input, timeout: defaultSeconds };
}
