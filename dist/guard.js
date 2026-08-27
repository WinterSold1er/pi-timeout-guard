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
const SCANNER_TOOLS = {
    find: { needsRecursiveFlag: false },
    du: { needsRecursiveFlag: false },
    grep: { needsRecursiveFlag: true },
    rg: { needsRecursiveFlag: false },
    ack: { needsRecursiveFlag: false },
};
const WRAPPER_WORDS = new Set(["sudo", "env", "time", "command", "nohup", "nice"]);
function splitStatements(cmd) {
    // Split on shell statement separators. Good enough for danger detection.
    return cmd
        .split(/;|\|\|&&|\||\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}
function tokenize(stmt) {
    const tokens = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(stmt)))
        tokens.push(m[1] ?? m[2] ?? m[3]);
    return tokens;
}
// Strip leading shell metacharacters but KEEP ./ and / so that
// `./find` is NOT mistaken for the `find` command, while `(find` is.
function stripShellMeta(tok) {
    return tok.replace(/^[;|&()<>]*/, "");
}
function toolNameOf(tok) {
    const t = stripShellMeta(tok);
    // Bare command name, or an absolute path to the binary (e.g. /usr/bin/find).
    // A relative path like ./find must NOT match.
    if (t === "find" || (t.startsWith("/") && t.endsWith("/find")))
        return "find";
    if (t === "du" || (t.startsWith("/") && t.endsWith("/du")))
        return "du";
    if (t === "grep" || (t.startsWith("/") && t.endsWith("/grep")))
        return "grep";
    if (t === "rg" || (t.startsWith("/") && t.endsWith("/rg")))
        return "rg";
    if (t === "ack" || (t.startsWith("/") && t.endsWith("/ack")))
        return "ack";
    return null;
}
function isRootPath(p) {
    return p === ROOT_PATH || p === "//";
}
function hasRecursiveFlag(tokens) {
    for (const t of tokens) {
        if (t.startsWith("-") && !t.startsWith("--")) {
            if (/[rR]/.test(t))
                return true;
        }
        else if (t.startsWith("--")) {
            if (t === "--recursive" || t === "--all" || t === "--files-with-matches")
                return true;
        }
    }
    return false;
}
/**
 * Analyze a raw bash command string for a full-filesystem scan rooted at `/`.
 * Conservative by design: prefer misses over false positives. Returns
 * `{ block: true, reason }` only for clearly unbounded root walks.
 */
export function analyzeBashCommand(command) {
    try {
        for (const stmt of splitStatements(command)) {
            const tokens = tokenize(stmt);
            if (tokens.length === 0)
                continue;
            let i = 0;
            while (i < tokens.length && WRAPPER_WORDS.has(stripShellMeta(tokens[i])))
                i++;
            if (i >= tokens.length)
                continue;
            const tool = toolNameOf(tokens[i]);
            if (!tool)
                continue;
            const cfg = SCANNER_TOOLS[tool];
            const rest = tokens.slice(i + 1);
            const rootArg = rest.find((a) => isRootPath(a));
            if (!rootArg)
                continue;
            if (cfg.needsRecursiveFlag && !hasRecursiveFlag(rest))
                continue;
            return {
                block: true,
                reason: `Blocked: '${tool}' rooted at filesystem '/' can hang the session indefinitely. Scope the path (a subdirectory) and/or set an explicit timeout.`,
            };
        }
        return { block: false };
    }
    catch {
        return { block: false }; // fail open: never block on a guard bug
    }
}
/**
 * Analyze the root `path` argument of the standalone find/grep tools.
 * Blocks only the literal filesystem root `/` (narrow, safe).
 */
export function analyzeToolPath(toolName, path) {
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
    }
    catch {
        return { block: false };
    }
}
/**
 * Return input with a default timeout injected when one is missing or invalid.
 * A present, positive timeout is left untouched.
 */
export function injectBashTimeout(input, defaultSeconds = DEFAULT_TIMEOUT_SECONDS) {
    if (typeof input.timeout === "number" && input.timeout > 0)
        return input;
    return { ...input, timeout: defaultSeconds };
}
