import { getAxNodes } from './ax-snapshot';

export type DebuggerCommand = (
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs?: number
) => Promise<unknown>;

export const SNAPSHOT_REF_ATTRIBUTE = 'data-bv-ref';

const MAX_REF_ASSIGNMENTS = 500;
const MAX_REF_WARNINGS = 5;

const isInspectError = (
  error: unknown
): error is { name: string; message: string } =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: unknown }).name === 'InspectError' &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
  );

export const assignRefsToAxSnapshot = (
  snapshot: unknown
): Map<number, string> => {
  const nodes = getAxNodes(snapshot);
  const refs = new Map<number, string>();
  let index = 1;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (node.ignored) {
      continue;
    }
    const backendId = node.backendDOMNodeId;
    if (typeof backendId !== 'number') {
      continue;
    }
    const ref = `@e${index}`;
    index += 1;
    node.ref = ref;
    refs.set(backendId, ref);
  }
  return refs;
};

export const clearSnapshotRefs = async (
  tabId: number,
  debuggerCommand: DebuggerCommand
): Promise<void> => {
  await debuggerCommand(tabId, 'Runtime.evaluate', {
    expression: `document.querySelectorAll('[${SNAPSHOT_REF_ATTRIBUTE}]').forEach((el) => el.removeAttribute('${SNAPSHOT_REF_ATTRIBUTE}'))`,
    returnByValue: true,
    awaitPromise: true,
  });
};

export const applySnapshotRefs = async (
  tabId: number,
  refs: Map<number, string>,
  debuggerCommand: DebuggerCommand
): Promise<string[]> => {
  const warnings: string[] = [];
  await debuggerCommand(tabId, 'DOM.enable', {});
  await debuggerCommand(tabId, 'Runtime.enable', {});

  try {
    await clearSnapshotRefs(tabId, debuggerCommand);
  } catch {
    warnings.push('Failed to clear prior snapshot refs.');
  }

  if (refs.size === 0) {
    return warnings;
  }

  let applied = 0;
  for (const [backendNodeId, ref] of refs) {
    if (applied >= MAX_REF_ASSIGNMENTS) {
      warnings.push(
        `Snapshot refs truncated at ${MAX_REF_ASSIGNMENTS} elements.`
      );
      break;
    }
    try {
      const described = await debuggerCommand(tabId, 'DOM.describeNode', {
        backendNodeId,
      });
      const node = (
        described as { node?: { nodeId?: number; nodeType?: number } }
      ).node;
      if (!node || node.nodeType !== 1 || typeof node.nodeId !== 'number') {
        if (warnings.length < MAX_REF_WARNINGS) {
          warnings.push(`Ref ${ref} could not be applied to a DOM element.`);
        }
        continue;
      }
      await debuggerCommand(tabId, 'DOM.setAttributeValue', {
        nodeId: node.nodeId,
        name: SNAPSHOT_REF_ATTRIBUTE,
        value: ref,
      });
      applied += 1;
    } catch {
      if (warnings.length < MAX_REF_WARNINGS) {
        warnings.push(`Ref ${ref} could not be applied.`);
      }
    }
  }
  return warnings;
};

export const resolveNodeIdForSelector = async (
  tabId: number,
  selector: string,
  debuggerCommand: DebuggerCommand
): Promise<{ nodeId?: number; warnings?: string[] }> => {
  await debuggerCommand(tabId, 'DOM.enable', {});
  const document = await debuggerCommand(tabId, 'DOM.getDocument', {
    depth: 1,
  });
  const rootNodeId = (document as { root?: { nodeId?: number } }).root?.nodeId;
  if (typeof rootNodeId !== 'number') {
    return { warnings: ['Failed to resolve DOM root for selector.'] };
  }
  try {
    const result = await debuggerCommand(tabId, 'DOM.querySelector', {
      nodeId: rootNodeId,
      selector,
    });
    const nodeId = (result as { nodeId?: number }).nodeId;
    if (!nodeId) {
      return { warnings: [`Selector not found: ${selector}`] };
    }
    return { nodeId };
  } catch (error) {
    if (isInspectError(error)) {
      return { warnings: [error.message] };
    }
    return { warnings: ['Selector query failed.'] };
  }
};
