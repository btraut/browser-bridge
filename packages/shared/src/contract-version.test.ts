import { describe, expect, it } from 'vitest';
import {
  HTTP_CONTRACT_VERSION,
  resolveContractVersionMismatch,
} from './contract-version';

describe('contract version helpers', () => {
  it('accepts missing or matching versions', () => {
    expect(resolveContractVersionMismatch(undefined)).toBeUndefined();
    expect(resolveContractVersionMismatch('')).toBeUndefined();
    expect(
      resolveContractVersionMismatch(HTTP_CONTRACT_VERSION)
    ).toBeUndefined();
  });

  it('reports deterministic mismatch payload', () => {
    expect(resolveContractVersionMismatch('legacy-1')).toEqual({
      expected: HTTP_CONTRACT_VERSION,
      received: 'legacy-1',
    });
  });
});
