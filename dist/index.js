import { analyzeBashCommand, analyzeToolPath, injectBashTimeout, DEFAULT_TIMEOUT_SECONDS, } from "./guard.js";
// Single externalized knob: default bash timeout (seconds).
// Override without editing source via env, e.g. PI_TIMEOUT_GUARD_SECONDS=120.
const DEFAULT_TIMEOUT = Number(process.env.PI_TIMEOUT_GUARD_SECONDS) > 0
    ? Number(process.env.PI_TIMEOUT_GUARD_SECONDS)
    : DEFAULT_TIMEOUT_SECONDS;
// Appended to every block reason so a model does not spin retrying the same
// doomed command; it must scope the path and set an explicit timeout instead.
const RETRY_HINT = " 不要重试相同命令；改用具名子目录 + 显式 timeout。";
/**
 * pi-timeout-guard extension factory.
 *
 * Registers one `tool_call` handler that:
 *   1. Blocks clearly unbounded full-filesystem scans (find /, grep -r /, du /, ...).
 *   2. Injects a default timeout into bash calls that omit one, so a runaway
 *      command cannot hang the session (or a sub-agent) forever.
 */
export default function timeoutGuard(pi) {
    pi.on("tool_call", (event) => {
        try {
            if (event.toolName === "bash") {
                const input = event.input;
                const verdict = analyzeBashCommand(input.command);
                if (verdict.block)
                    return { block: true, reason: verdict.reason + RETRY_HINT };
                const patched = injectBashTimeout(input, DEFAULT_TIMEOUT);
                if (patched.timeout !== input.timeout) {
                    input.timeout = patched.timeout;
                }
                return;
            }
            if (event.toolName === "grep") {
                const v = analyzeToolPath("grep", event.input.path);
                if (v.block)
                    return { block: true, reason: v.reason + RETRY_HINT };
                return;
            }
            if (event.toolName === "find") {
                const v = analyzeToolPath("find", event.input.path);
                if (v.block)
                    return { block: true, reason: v.reason + RETRY_HINT };
                return;
            }
        }
        catch {
            // Fail open: a guard error must never block legitimate tool calls.
            return;
        }
    });
}
