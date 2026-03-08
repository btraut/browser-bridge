export type CoreEndpointConfig = {
  host: string;
  port: number;
  portSource: 'default';
};

type LocalStorageArea = {
  get(
    keys: string[],
    callback: (items: Record<string, unknown>) => void
  ): void;
  remove(keys: string[], callback?: () => void): void;
};

export const DEFAULT_CORE_HOST = '127.0.0.1';
export const DEFAULT_CORE_PORT = 3210;
export const LEGACY_CORE_PORT_KEY = 'corePort';

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const readCoreEndpointConfig = async (): Promise<CoreEndpointConfig> => ({
  host: DEFAULT_CORE_HOST,
  port: DEFAULT_CORE_PORT,
  portSource: 'default',
});

export const clearLegacyCorePort = async (
  storage: LocalStorageArea
): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    storage.get([LEGACY_CORE_PORT_KEY], (items) => {
      if (!hasOwn(items, LEGACY_CORE_PORT_KEY)) {
        resolve(false);
        return;
      }
      storage.remove([LEGACY_CORE_PORT_KEY], () => resolve(true));
    });
  });
};
