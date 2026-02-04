import { spawn } from 'node:child_process';

export const openPath = async (target: string): Promise<void> => {
  const platform = process.platform;

  if (platform === 'darwin') {
    const child = spawn('open', [target], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }

  if (platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', target], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  const child = spawn('xdg-open', [target], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
};
