import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * pi-timeout-guard extension factory.
 *
 * Registers one `tool_call` handler that:
 *   1. Blocks clearly unbounded full-filesystem scans (find /, grep -r /, du /, ...).
 *   2. Injects a default timeout into bash calls that omit one, so a runaway
 *      command cannot hang the session (or a sub-agent) forever.
 */
export default function timeoutGuard(pi: ExtensionAPI): void;
