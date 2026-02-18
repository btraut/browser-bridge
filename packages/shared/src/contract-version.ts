export const HTTP_CONTRACT_VERSION_HEADER = 'x-browser-bridge-contract-version';

export const HTTP_CONTRACT_VERSION = '2026-02-17.1';

export const DRIVE_WS_PROTOCOL_VERSION = '2026-02-17.1';

export const resolveContractVersionMismatch = (
  receivedVersion: string | undefined
):
  | {
      expected: string;
      received: string;
    }
  | undefined => {
  if (!receivedVersion || receivedVersion.trim().length === 0) {
    return undefined;
  }

  if (receivedVersion === HTTP_CONTRACT_VERSION) {
    return undefined;
  }

  return {
    expected: HTTP_CONTRACT_VERSION,
    received: receivedVersion,
  };
};
