import { describe, expect, it } from 'vitest';
import {
  DRIVE_NAVIGATE_PARITY_CASES,
  DriveNavigateInputSchema,
  DriveNavigateOutputSchema,
  MCP_TOOL_DEFINITIONS,
} from '@btraut/browser-bridge-shared';
import {
  CLI_DRIVE_NAVIGATE_PARITY_FIXTURES,
  CLI_TOOL_COVERAGE_MATRIX,
  CLI_TOOL_FIXTURES,
} from './tool-fixtures';

describe('cli tool fixtures (contract)', () => {
  it('uses unique fixture names', () => {
    const names = CLI_TOOL_FIXTURES.map((fixture) => fixture.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers the MCP tool list', () => {
    const mcpNames = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
    const coreNames = CLI_TOOL_FIXTURES.filter(
      (fixture) => fixture.kind === 'core'
    ).map((fixture) => fixture.name);

    expect(coreNames).toEqual(mcpNames);
  });

  it('keeps core paths aligned with shared list', () => {
    const byName = new Map(
      MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.corePath])
    );

    for (const fixture of CLI_TOOL_FIXTURES) {
      if (fixture.kind !== 'core') {
        continue;
      }
      expect(fixture.corePath).toBe(byName.get(fixture.name));
    }
  });

  it('tracks coverage for every fixture', () => {
    const fixtureNames = CLI_TOOL_FIXTURES.map((fixture) => fixture.name);
    const coverageNames = CLI_TOOL_COVERAGE_MATRIX.map((row) => row.name);

    expect(coverageNames).toEqual(fixtureNames);
    for (const row of CLI_TOOL_COVERAGE_MATRIX) {
      expect(row.fixture).toBe('covered');
      expect(row.contract).toBe('covered');
    }
  });

  it('covers drive.navigate parity variants against shared contracts', () => {
    expect(CLI_DRIVE_NAVIGATE_PARITY_FIXTURES).toHaveLength(2);
    expect(
      CLI_DRIVE_NAVIGATE_PARITY_FIXTURES.map((fixture) => fixture.caseId)
    ).toEqual(
      DRIVE_NAVIGATE_PARITY_CASES.map((parityCase) => parityCase.caseId)
    );

    for (const fixture of CLI_DRIVE_NAVIGATE_PARITY_FIXTURES) {
      const expected = DRIVE_NAVIGATE_PARITY_CASES.find(
        (parityCase) => parityCase.caseId === fixture.caseId
      );
      expect(expected).toBeDefined();
      expect(fixture.payload).toEqual(expected?.input);
      expect(fixture.successResult).toEqual(expected?.successResult);
      expect(DriveNavigateInputSchema.safeParse(fixture.payload).success).toBe(
        true
      );
      expect(
        DriveNavigateOutputSchema.safeParse(fixture.successResult).success
      ).toBe(true);
    }
  });
});
