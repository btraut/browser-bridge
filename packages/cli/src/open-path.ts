import { spawn } from 'node:child_process';

const shouldOpenInChrome = (target: string): boolean =>
  /^chrome(?:-extension)?:\/\//.test(target);

export const openPath = async (target: string): Promise<void> => {
  const platform = process.platform;

  if (platform === 'darwin') {
    const args = shouldOpenInChrome(target)
      ? ['-a', 'Google Chrome', target]
      : [target];
    const child = spawn('open', args, { detached: true, stdio: 'ignore' });
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
