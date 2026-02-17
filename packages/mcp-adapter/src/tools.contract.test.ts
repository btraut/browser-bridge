import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MCP_DRIVE_NAVIGATE_PARITY_FIXTURES,
  MCP_TOOL_COVERAGE_MATRIX,
  MCP_TOOL_FIXTURES,
} from './tool-fixtures';
import {
  DRIVE_NAVIGATE_PARITY_CASES,
  DriveNavigateInputSchema,
  DriveNavigateOutputSchema,
  MCP_TOOL_DEFINITIONS,
} from '@btraut/browser-bridge-shared';
import { TOOL_DEFINITIONS } from './tools';

type SchemaLike = {
  safeParse?: (value: unknown) => { success: boolean; error?: unknown };
};

const parseWithSchema = (schema: unknown, value: unknown) => {
  if (schema && typeof (schema as SchemaLike).safeParse === 'function') {
    return (schema as SchemaLike).safeParse?.(value);
  }

  if (schema && typeof schema === 'object') {
    return z.object(schema as z.ZodRawShape).safeParse(value);
  }

  return { success: false } as const;
};

describe('mcp-adapter tool definitions (contract)', () => {
  it('uses unique tool names', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('matches the shared MCP tool list', () => {
    const sharedNames = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
    const toolNames = TOOL_DEFINITIONS.map((tool) => tool.name);

    expect(toolNames).toEqual(sharedNames);
  });

  it('uses routable core paths without over-constraining internals', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.config.corePath.startsWith('/')).toBe(true);
      expect(tool.config.corePath.includes(' ')).toBe(false);
      expect(tool.config.corePath.length).toBeGreaterThan(1);
    }
  });

  it('has fixture + coverage entries for every tool', () => {
    const fixtureNames = MCP_TOOL_FIXTURES.map((fixture) => fixture.name);
    const coverageNames = MCP_TOOL_COVERAGE_MATRIX.map((row) => row.name);

    const toolNames = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(fixtureNames).toEqual(toolNames);
    expect(coverageNames).toEqual(toolNames);
  });

  it('keeps fixtures aligned with tool schemas', () => {
    const fixturesByName = new Map(
      MCP_TOOL_FIXTURES.map((fixture) => [fixture.name, fixture])
    );

    for (const tool of TOOL_DEFINITIONS) {
      const fixture = fixturesByName.get(tool.name);
      expect(fixture).toBeDefined();
      if (!fixture) {
        continue;
      }

      expect(tool.config.title.length).toBeGreaterThan(0);
      expect(tool.config.description.length).toBeGreaterThan(0);
      expect(fixture.corePath).toBe(tool.config.corePath);

      const inputResult = parseWithSchema(
        tool.config.inputSchema,
        fixture.input
      );
      expect(inputResult?.success).toBe(true);

      const outputResult = parseWithSchema(
        tool.config.outputSchema,
        fixture.successEnvelope
      );
      expect(outputResult?.success).toBe(true);
    }
  });

  it('tracks expected coverage levels', () => {
    const coverageByName = new Map(
      MCP_TOOL_COVERAGE_MATRIX.map((row) => [row.name, row])
    );

    for (const tool of TOOL_DEFINITIONS) {
      const coverage = coverageByName.get(tool.name);
      expect(coverage).toBeDefined();
      if (!coverage) {
        continue;
      }

      expect(coverage.fixture).toBe('covered');
      expect(coverage.contract).toBe('covered');
      expect(coverage.wiring).toBe('covered');
      expect(coverage.integration).toBe('covered');
      expect(coverage.e2e).toBe('optional');
    }
  });

  it('covers drive.navigate parity fixtures for explicit and missing session variants', () => {
    expect(MCP_DRIVE_NAVIGATE_PARITY_FIXTURES).toHaveLength(2);
    expect(
      MCP_DRIVE_NAVIGATE_PARITY_FIXTURES.map((fixture) => fixture.caseId)
    ).toEqual(
      DRIVE_NAVIGATE_PARITY_CASES.map((parityCase) => parityCase.caseId)
    );

    for (const fixture of MCP_DRIVE_NAVIGATE_PARITY_FIXTURES) {
      const expected = DRIVE_NAVIGATE_PARITY_CASES.find(
        (parityCase) => parityCase.caseId === fixture.caseId
      );
      expect(expected).toBeDefined();
      expect(fixture.input).toEqual(expected?.input);
      expect(fixture.successEnvelope).toEqual({
        ok: true,
        result: expected?.successResult,
      });
      expect(DriveNavigateInputSchema.safeParse(fixture.input).success).toBe(
        true
      );
      expect(fixture.successEnvelope.ok).toBe(true);
      if (!fixture.successEnvelope.ok) {
        throw new Error(
          `Expected success envelope for parity case ${fixture.caseId}`
        );
      }
      expect(
        DriveNavigateOutputSchema.safeParse(fixture.successEnvelope.result)
          .success
      ).toBe(true);
    }
  });
});
