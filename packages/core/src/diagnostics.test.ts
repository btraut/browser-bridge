import { describe, expect, it } from "vitest";
import { buildDiagnosticReport } from "./diagnostics";
import { getArtifactRootDir } from "./artifacts";

describe("buildDiagnosticReport", () => {
  it("includes artifact root when session id is provided", () => {
    const report = buildDiagnosticReport("session-123");
    expect(report.artifacts?.root_dir).toBe(getArtifactRootDir("session-123"));
    expect(report.session_id).toBe("session-123");
  });

  it("includes extension status by default", () => {
    const report = buildDiagnosticReport();
    expect(report.extension?.connected).toBe(false);
    const debuggerCheck = report.checks?.find(
      (check) => check.name === "debugger.attached"
    );
    expect(debuggerCheck?.ok).toBe(false);
  });
});
