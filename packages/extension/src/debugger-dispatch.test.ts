import { describe, expect, it, vi } from 'vitest';
import { dispatchDebuggerRequest } from './debugger-dispatch';

const createDeps = () => ({
  getSession: vi.fn(),
  ensureDebuggerAttached: vi.fn(async () => null),
  detachDebugger: vi.fn(async () => null),
  sendDebuggerCommand: vi.fn(async () => ({ ok: true })),
  touchDebuggerSession: vi.fn(),
  clearDebuggerSession: vi.fn(),
  mapDebuggerErrorMessage: vi.fn((message: string) => ({
    code: 'INTERNAL',
    message,
    retryable: false,
  })),
  debuggerCommandTimeoutMs: 5000,
});

const createResponders = () => ({
  respondAck: vi.fn(),
  respondError: vi.fn(),
});

describe('dispatchDebuggerRequest', () => {
  it('rejects missing tab ids for attach', async () => {
    const deps = createDeps();
    const responders = createResponders();

    await dispatchDebuggerRequest(
      {
        id: '1',
        action: 'debugger.attach',
        status: 'request',
        params: {},
      },
      deps,
      responders
    );

    expect(responders.respondError).toHaveBeenCalledWith({
      code: 'INVALID_ARGUMENT',
      message: 'tab_id must be a number.',
      retryable: false,
    });
  });

  it('acks successful attach requests', async () => {
    const deps = createDeps();
    const responders = createResponders();

    await dispatchDebuggerRequest(
      {
        id: '1',
        action: 'debugger.attach',
        status: 'request',
        params: { tab_id: 9 },
      },
      deps,
      responders
    );

    expect(deps.ensureDebuggerAttached).toHaveBeenCalledWith(9);
    expect(responders.respondAck).toHaveBeenCalledWith({ ok: true });
  });

  it('requires an attached session before debugger.command', async () => {
    const deps = createDeps();
    const responders = createResponders();
    deps.getSession.mockReturnValue(undefined);

    await dispatchDebuggerRequest(
      {
        id: '1',
        action: 'debugger.command',
        status: 'request',
        params: { tab_id: 5, method: 'Runtime.evaluate' },
      },
      deps,
      responders
    );

    expect(responders.respondError).toHaveBeenCalledWith({
      code: 'FAILED_PRECONDITION',
      message: 'Debugger is not attached to the requested tab.',
      retryable: false,
    });
  });

  it('forwards debugger commands through the adapter deps', async () => {
    const deps = createDeps();
    const responders = createResponders();
    deps.getSession.mockReturnValue({ attached: true });

    await dispatchDebuggerRequest(
      {
        id: '1',
        action: 'debugger.command',
        status: 'request',
        params: {
          tab_id: 5,
          method: 'Runtime.evaluate',
          params: { expression: '1 + 1' },
        },
      },
      deps,
      responders
    );

    expect(deps.sendDebuggerCommand).toHaveBeenCalledWith(
      5,
      'Runtime.evaluate',
      { expression: '1 + 1' },
      5000
    );
    expect(deps.touchDebuggerSession).toHaveBeenCalledWith(5);
    expect(responders.respondAck).toHaveBeenCalledWith({ ok: true });
  });
});
