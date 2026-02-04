import { describe, expect, it } from "vitest";
import { buildDiagnosticReport } from "./diagnostics";
import { getArtifactRootDir } from "./artifacts";

describe("buildDiagnosticReport", () => {
  it("includes artifact root when session id is provided", () => {
    const report = buildDiagnosticReport("session-123");
    expect(report.artifacts?.root_dir).toBe(getArtifactRootDir("session-123"));
    expect(report.session_id).toBe("session-123");
  });

  it("uses configured chrome path when provided", () => {
    const previous = process.env.BROWSER_VISION_CHROME_PATH;
    const previousLegacy = process.env.CHROME_PATH;
    try {
      process.env.BROWSER_VISION_CHROME_PATH = "/tmp/chrome";
      delete process.env.CHROME_PATH;

      const report = buildDiagnosticReport();
      expect(report.chrome?.path).toBe("/tmp/chrome");
      expect(report.warnings).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.BROWSER_VISION_CHROME_PATH;
      } else {
        process.env.BROWSER_VISION_CHROME_PATH = previous;
      }

      if (previousLegacy === undefined) {
        delete process.env.CHROME_PATH;
      } else {
        process.env.CHROME_PATH = previousLegacy;
      }
    }
  });
});
