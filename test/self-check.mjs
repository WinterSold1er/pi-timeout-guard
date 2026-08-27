import assert from "node:assert/strict";
import {
  analyzeBashCommand,
  analyzeToolPath,
  injectBashTimeout,
  DEFAULT_TIMEOUT_SECONDS,
} from "../dist/guard.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
}

// --- bash: full-filesystem scans are blocked ---
check("find / blocked", () => assert.ok(analyzeBashCommand("find /").block));
check("find / -name blocked", () => assert.ok(analyzeBashCommand("find / -name '*.log'").block));
check("sudo find / blocked", () => assert.ok(analyzeBashCommand("sudo find /").block));
check("piped find / blocked", () => assert.ok(analyzeBashCommand("echo x | find /").block));
check("du / blocked", () => assert.ok(analyzeBashCommand("du /").block));
check("du -sh / blocked", () => assert.ok(analyzeBashCommand("du -sh /").block));
check("grep -r / blocked", () => assert.ok(analyzeBashCommand("grep -r /").block));
check("grep -rl pattern / blocked", () => assert.ok(analyzeBashCommand("grep -rl pattern /").block));
check("rg -uu / blocked", () => assert.ok(analyzeBashCommand("rg -uu /").block));

// --- M1: wrapper/inline-env words with args must NOT leak (all blocked) ---
check("sudo -u root find / blocked", () => assert.ok(analyzeBashCommand("sudo -u root find /").block));
check("sudo -E find / blocked", () => assert.ok(analyzeBashCommand("sudo -E find /").block));
check("env FOO=bar find / blocked", () => assert.ok(analyzeBashCommand("env FOO=bar find /").block));
check("GOOS=linux find / blocked", () => assert.ok(analyzeBashCommand("GOOS=linux find /").block));
check("VAR=val find / blocked", () => assert.ok(analyzeBashCommand("VAR=val find /").block));
check("time -v find / blocked", () => assert.ok(analyzeBashCommand("time -v find /").block));
check("nice -n 19 find / blocked", () => assert.ok(analyzeBashCommand("nice -n 19 find /").block));
check("time -v grep -r x / blocked", () => assert.ok(analyzeBashCommand("time -v grep -r x /").block));
check("env -C / sudo find / blocked", () => assert.ok(analyzeBashCommand("env -C / sudo find /").block));

// --- M2: heredoc body is literal data, must NOT be blocked ---
check("heredoc cat with find / body not blocked", () => assert.ok(!analyzeBashCommand("cat > /tmp/x <<'EOF'\nfind /\nEOF").block));
check("heredoc grep with find / body not blocked", () => assert.ok(!analyzeBashCommand("grep -r x /tmp <<EOF\nfind /\nEOF").block));
check("here-string not blocked", () => assert.ok(!analyzeBashCommand("grep foo <<< 'find /'").block));

// --- bash: bounded / local scans are NOT blocked (prefer false negatives) ---
check("find /home not blocked", () => assert.ok(!analyzeBashCommand("find /home/user").block));
check("find . not blocked", () => assert.ok(!analyzeBashCommand("find .").block));
check("./find / not blocked", () => assert.ok(!analyzeBashCommand("./find /").block));
check("/usr/bin/find / not blocked? (path-qualified cmd)", () => assert.ok(!analyzeBashCommand("/usr/bin/find .").block));
check("grep -r /home not blocked (bounded)", () => assert.ok(!analyzeBashCommand("grep -r /home/user").block));
check("grep -r x /home not blocked (bounded)", () => assert.ok(!analyzeBashCommand("grep -r x /home").block));
check("grep / (no -r) not blocked", () => assert.ok(!analyzeBashCommand("grep /").block));
check("ls / not blocked", () => assert.ok(!analyzeBashCommand("ls /").block));
check("cat /etc/passwd not blocked", () => assert.ok(!analyzeBashCommand("cat /etc/passwd").block));

// --- standalone find/grep tools: root path arg blocked ---
check("tool find / blocked", () => assert.ok(analyzeToolPath("find", "/").block));
check("tool find /home not blocked", () => assert.ok(!analyzeToolPath("find", "/home").block));
check("tool grep / blocked", () => assert.ok(analyzeToolPath("grep", "/").block));
check("tool grep ./ not blocked", () => assert.ok(!analyzeToolPath("grep", ".").block));
check("tool read /etc not blocked", () => assert.ok(!analyzeToolPath("read", "/etc/passwd").block));

// --- timeout injection ---
check("inject sets default 60", () => assert.equal(injectBashTimeout({ command: "x" }).timeout, DEFAULT_TIMEOUT_SECONDS));
check("inject keeps explicit", () => assert.equal(injectBashTimeout({ command: "x", timeout: 10 }).timeout, 10));
check("inject sets on 0/neg", () => assert.equal(injectBashTimeout({ command: "x", timeout: 0 }).timeout, DEFAULT_TIMEOUT_SECONDS));
check("DEFAULT_TIMEOUT_SECONDS is 60", () => assert.equal(DEFAULT_TIMEOUT_SECONDS, 60));

console.log(`OK: ${passed} self-checks passed`);
