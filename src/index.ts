import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import {
  analyzeBashCommand,
  analyzeToolPath,
  injectBashTimeout,
  DEFAULT_TIMEOUT_SECONDS,
} from "./guard.js";

// Single externalized knob: default bash timeout (seconds).
// Override without editing source via env, e.g. PI_TIMEOUT_GUARD_SECONDS=120.
const DEFAULT_TIMEOUT =
  Number(process.env.PI_TIMEOUT_GUARD_SECONDS) > 0
    ? Number(process.env.PI_TIMEOUT_GUARD_SECONDS)
    : DEFAULT_TIMEOUT_SECONDS;

// Local view of the tool inputs we touch. We narrow the `tool_call` union by
// `toolName` (a string on CustomToolCallEvent, so a hard cast is needed at this
// boundary) rather than importing the runtime `isToolCallEventType` guard. This
// keeps the compiled extension free of any runtime dependency on the pi package,
// so it loads in plain Node and in any pi version.
interface BashLikeInput {
  command: string;
  timeout?: number;
}
interface PathLikeInput {
  path?: string;
}

/**
 * pi-timeout-guard extension factory.
 *
 * Registers one `tool_call` handler that:
 *   1. Blocks clearly unbounded full-filesystem scans (find /, grep -r /, du /, ...).
 *   2. Injects a default timeout into bash calls that omit one, so a runaway
 *      command cannot hang the session (or a sub-agent) forever.
 */
export default function timeoutGuard(pi: ExtensionAPI): void {
  pi.on("tool_call", (event: ToolCallEvent): ToolCallEventResult | void => {
    try {
      if (event.toolName === "bash") {
        const input = event.input as unknown as BashLikeInput;
        const verdict = analyzeBashCommand(input.command);
        if (verdict.block) return { block: true, reason: verdict.reason };

        const patched = injectBashTimeout(input, DEFAULT_TIMEOUT);
        if (patched.timeout !== input.timeout) {
          input.timeout = patched.timeout;
        }
        return;
      }

      if (event.toolName === "grep") {
        const v = analyzeToolPath("grep", (event.input as unknown as PathLikeInput).path);
        if (v.block) return { block: true, reason: v.reason };
        return;
      }

      if (event.toolName === "find") {
        const v = analyzeToolPath("find", (event.input as unknown as PathLikeInput).path);
        if (v.block) return { block: true, reason: v.reason };
        return;
      }
    } catch {
      // Fail open: a guard error must never block legitimate tool calls.
      return;
    }
  });
}
