export declare const DEFAULT_TIMEOUT_SECONDS = 60;
export declare const ROOT_PATH = "/";
export interface GuardVerdict {
    block: boolean;
    reason?: string;
}
/**
 * Analyze a raw bash command string for a full-filesystem scan rooted at `/`.
 * Conservative by design: prefer misses over false positives. Returns
 * `{ block: true, reason }` only for clearly unbounded root walks.
 */
export declare function analyzeBashCommand(command: string): GuardVerdict;
/**
 * Analyze the root `path` argument of the standalone find/grep tools.
 * Blocks only the literal filesystem root `/` (narrow, safe).
 */
export declare function analyzeToolPath(toolName: string, path?: string): GuardVerdict;
export interface BashInput {
    command: string;
    timeout?: number;
}
/**
 * Return input with a default timeout injected when one is missing or invalid.
 * A present, positive timeout is left untouched.
 */
export declare function injectBashTimeout(input: BashInput, defaultSeconds?: number): BashInput;
