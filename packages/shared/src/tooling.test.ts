import { describe, expect, it } from 'vitest';
import {
  DEPRECATION_POLICY,
  MCP_TOOL_DEFINITIONS,
  type McpToolDefinition,
} from './tooling';

const parseIsoDate = (value: string) => {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return parsed;
};

const getDeprecatedTools = (tools: McpToolDefinition[]) =>
  tools.filter((tool) => tool.deprecation);

describe('shared deprecation policy (contract)', () => {
  it('enforces lifecycle metadata for deprecated tools', () => {
    const deprecatedTools = getDeprecatedTools(MCP_TOOL_DEFINITIONS);
    expect(deprecatedTools.length).toBeGreaterThan(0);

    const toolNames = new Set(MCP_TOOL_DEFINITIONS.map((tool) => tool.name));
    for (const tool of deprecatedTools) {
      const metadata = tool.deprecation;
      expect(metadata).toBeDefined();
      if (!metadata) {
        continue;
      }

      expect(metadata.stage).toBe('deprecated');
      expect(metadata.warning_behavior).toBe('warn-on-use');
      expect(metadata.migration_notes).toContain(
        DEPRECATION_POLICY.migration_notes_path
      );
      expect(metadata.replacement).not.toBe(tool.name);
      expect(toolNames.has(metadata.replacement)).toBe(true);

      const deprecatedSince = parseIsoDate(metadata.deprecated_since);
      const removalTarget = parseIsoDate(metadata.removal_target);
      expect(removalTarget).toBeGreaterThan(deprecatedSince);

      const daysToRemoval = Math.floor(
        (removalTarget - deprecatedSince) / (24 * 60 * 60 * 1000)
      );
      expect(daysToRemoval).toBeGreaterThanOrEqual(
        DEPRECATION_POLICY.minimum_notice_days
      );
    }
  });
});
