import type { ApiEnvelope } from "@browser-vision/shared";
import type { ErrorEnvelope } from "@browser-vision/shared";

export type ToolFixture = {
  name: string;
  corePath: string;
  input: unknown;
  successEnvelope: ApiEnvelope<unknown>;
  errorEnvelope?: ErrorEnvelope;
};

export type ToolCoverageStatus = "covered" | "optional" | "not_planned";

export type ToolCoverageRow = {
  name: string;
  fixture: ToolCoverageStatus;
  contract: ToolCoverageStatus;
  wiring: ToolCoverageStatus;
  integration: ToolCoverageStatus;
  e2e: ToolCoverageStatus;
};

export const MCP_TOOL_FIXTURES: ToolFixture[] = [
  {
    name: "session.create",
    corePath: "/session/create",
    input: {},
    successEnvelope: {
      ok: true,
      result: {
        session_id: "session-1",
        state: "READY",
      },
    },
  },
  {
    name: "session.status",
    corePath: "/session/status",
    input: { session_id: "session-1" },
    successEnvelope: {
      ok: true,
      result: {
        session_id: "session-1",
        state: "READY",
      },
    },
  },
  {
    name: "session.recover",
    corePath: "/session/recover",
    input: { session_id: "session-1" },
    successEnvelope: {
      ok: true,
      result: {
        session_id: "session-1",
        recovered: true,
        state: "READY",
      },
    },
  },
  {
    name: "session.close",
    corePath: "/session/close",
    input: { session_id: "session-1" },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: "drive.navigate",
    corePath: "/drive/navigate",
    input: {
      session_id: "session-1",
      url: "https://example.com",
      wait: "domcontentloaded",
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: "drive.click",
    corePath: "/drive/click",
    input: {
      session_id: "session-1",
      locator: { css: "button" },
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: "drive.type",
    corePath: "/drive/type",
    input: {
      session_id: "session-1",
      text: "hello",
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: "drive.scroll",
    corePath: "/drive/scroll",
    input: {
      session_id: "session-1",
      delta_y: 120,
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: "drive.wait_for",
    corePath: "/drive/wait_for",
    input: {
      session_id: "session-1",
      condition: {
        kind: "url_matches",
        value: "example.com",
      },
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: "drive.tab_list",
    corePath: "/drive/tab_list",
    input: { session_id: "session-1" },
    successEnvelope: {
      ok: true,
      result: {
        tabs: [
          {
            tab_id: 1,
            window_id: 1,
            url: "https://example.com",
            title: "Example Domain",
            active: true,
          },
        ],
      },
    },
  },
  {
    name: "drive.tab_activate",
    corePath: "/drive/tab_activate",
    input: {
      session_id: "session-1",
      tab_id: 1,
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: "drive.tab_close",
    corePath: "/drive/tab_close",
    input: {
      session_id: "session-1",
      tab_id: 1,
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: "inspect.dom_snapshot",
    corePath: "/inspect/dom_snapshot",
    input: {
      session_id: "session-1",
      format: "ax",
      consistency: "best_effort",
    },
    successEnvelope: {
      ok: true,
      result: {
        format: "ax",
        snapshot: {},
      },
    },
  },
  {
    name: "inspect.console_list",
    corePath: "/inspect/console_list",
    input: { session_id: "session-1" },
    successEnvelope: {
      ok: true,
      result: {
        entries: [],
      },
    },
  },
  {
    name: "inspect.network_har",
    corePath: "/inspect/network_har",
    input: { session_id: "session-1" },
    successEnvelope: {
      ok: true,
      result: {
        artifact_id: "artifact-1",
        path: "/tmp/network.har",
        mime: "application/json",
      },
    },
  },
  {
    name: "inspect.evaluate",
    corePath: "/inspect/evaluate",
    input: {
      session_id: "session-1",
      expression: "1 + 1",
    },
    successEnvelope: {
      ok: true,
      result: {
        value: 2,
      },
    },
  },
  {
    name: "inspect.performance_metrics",
    corePath: "/inspect/performance_metrics",
    input: { session_id: "session-1" },
    successEnvelope: {
      ok: true,
      result: {
        metrics: [
          {
            name: "FirstContentfulPaint",
            value: 123.4,
          },
        ],
      },
    },
  },
  {
    name: "artifacts.screenshot",
    corePath: "/artifacts/screenshot",
    input: {
      session_id: "session-1",
      target: "viewport",
    },
    successEnvelope: {
      ok: true,
      result: {
        artifact_id: "artifact-1",
        path: "/tmp/screenshot.png",
        mime: "image/png",
      },
    },
  },
  {
    name: "diagnostics.doctor",
    corePath: "/diagnostics/doctor",
    input: { session_id: "session-1" },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
        session_id: "session-1",
        checks: [
          {
            name: "extension",
            ok: true,
          },
        ],
      },
    },
  },
];

export const MCP_TOOL_COVERAGE_MATRIX: ToolCoverageRow[] = MCP_TOOL_FIXTURES.map(
  (fixture) => ({
    name: fixture.name,
    fixture: "covered",
    contract: "covered",
    wiring: "covered",
    integration: "covered",
    e2e: "optional",
  })
);
