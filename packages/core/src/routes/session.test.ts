import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionRegistry } from '../session';
import { createSessionRouter } from './session';

const servers = new Set<import('node:http').Server>();

afterEach(async () => {
  await Promise.all(
    Array.from(
      servers,
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        })
    )
  );
  servers.clear();
});

const startSessionServer = async (
  registry: SessionRegistry
): Promise<string> => {
  const app = express();
  app.use(express.json());
  app.use('/session', createSessionRouter(registry));
  const server = createHttpServer(app);
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected test server address.');
  }
  return `http://127.0.0.1:${address.port}`;
};

describe('createSessionRouter', () => {
  it('returns selected_tab_id in session status once the session is pinned', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.setSelectedTab(session.id, 77);
    const baseUrl = await startSessionServer(registry);

    const response = await fetch(`${baseUrl}/session/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: session.id }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        session_id: session.id,
        state: session.state,
        selected_tab_id: 77,
      }),
    });
  });
});
