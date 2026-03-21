export type AxNodeRecord = {
  nodeId?: string;
  backendDOMNodeId?: number;
  role?: { value?: string } | string;
  name?: { value?: string } | string;
  ignored?: boolean;
  childIds?: string[];
  properties?: unknown[];
  ref?: string;
};

const INTERACTIVE_AX_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'listbox',
  'menu',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'checkbox',
  'radio',
  'switch',
  'searchbox',
  'spinbutton',
  'slider',
  'option',
]);

const DECORATIVE_AX_ROLES = new Set(['generic', 'none', 'presentation']);

export const LABEL_AX_ROLES = new Set([
  'textbox',
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'switch',
  'searchbox',
  'spinbutton',
  'slider',
]);

export const getAxNodes = (snapshot: unknown): AxNodeRecord[] => {
  const nodes = Array.isArray(snapshot)
    ? snapshot
    : (snapshot as { nodes?: unknown[] })?.nodes;
  return Array.isArray(nodes) ? (nodes as AxNodeRecord[]) : [];
};

const replaceAxNodes = (snapshot: unknown, nodes: AxNodeRecord[]): unknown => {
  if (Array.isArray(snapshot)) {
    return nodes;
  }
  if (snapshot && typeof snapshot === 'object') {
    (snapshot as { nodes?: unknown[] }).nodes = nodes;
  }
  return snapshot;
};

export const getAxRole = (node: AxNodeRecord): string => {
  const role =
    typeof node.role === 'string' ? node.role : (node.role?.value ?? '');
  return typeof role === 'string' ? role.toLowerCase() : '';
};

export const getAxName = (node: AxNodeRecord): string => {
  const name =
    typeof node.name === 'string' ? node.name : (node.name?.value ?? '');
  return typeof name === 'string' ? name : '';
};

const hasAxValue = (node: AxNodeRecord): boolean => {
  if (!Array.isArray(node.properties)) {
    return false;
  }
  for (const prop of node.properties) {
    if (!prop || typeof prop !== 'object') {
      continue;
    }
    const value = (prop as { value?: { value?: unknown } }).value?.value;
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      continue;
    }
    return true;
  }
  return false;
};

export const normalizeQuery = (value: string): string =>
  value.trim().toLowerCase();

export const matchesTextValue = (value: string, query: string): boolean => {
  if (!query) {
    return false;
  }
  return value.toLowerCase().includes(query);
};

export const matchesAxText = (node: AxNodeRecord, query: string): boolean => {
  if (!query) {
    return false;
  }
  const candidates = [getAxName(node)];
  if (Array.isArray(node.properties)) {
    for (const prop of node.properties) {
      if (!prop || typeof prop !== 'object') {
        continue;
      }
      const value = (prop as { value?: { value?: unknown } }).value?.value;
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === 'string') {
        candidates.push(value);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        candidates.push(String(value));
      }
    }
  }
  return candidates.some((text) => matchesTextValue(text, query));
};

const isInteractiveAxNode = (node: AxNodeRecord): boolean => {
  const role = getAxRole(node);
  return Boolean(role && INTERACTIVE_AX_ROLES.has(role));
};

const filterAxSnapshot = (
  snapshot: unknown,
  predicate: (node: AxNodeRecord) => boolean
): unknown => {
  const nodes = getAxNodes(snapshot);
  if (nodes.length === 0) {
    return snapshot;
  }
  const keepIds = new Set<string>();
  const filtered = nodes.filter((node) => {
    if (!node || typeof node !== 'object') {
      return false;
    }
    const keep = predicate(node);
    if (keep && typeof node.nodeId === 'string') {
      keepIds.add(node.nodeId);
    }
    return keep;
  });
  for (const node of filtered) {
    if (Array.isArray(node.childIds)) {
      node.childIds = node.childIds.filter((id) => keepIds.has(id));
    }
  }
  return replaceAxNodes(snapshot, filtered);
};

export const filterAxSnapshotByRefs = (
  snapshot: unknown,
  allowedRefs: Set<string>
): unknown =>
  filterAxSnapshot(snapshot, (node) => {
    const ref = node.ref;
    return typeof ref === 'string' && allowedRefs.has(ref);
  });

const collectKeptDescendants = (
  nodeId: string,
  nodeById: Map<string, AxNodeRecord>,
  keepIds: Set<string>,
  visited: Set<string> = new Set()
): string[] => {
  if (visited.has(nodeId)) {
    return [];
  }
  visited.add(nodeId);
  if (keepIds.has(nodeId)) {
    return [nodeId];
  }
  const node = nodeById.get(nodeId);
  if (!node || !Array.isArray(node.childIds)) {
    return [];
  }
  const output: string[] = [];
  for (const childId of node.childIds) {
    output.push(...collectKeptDescendants(childId, nodeById, keepIds, visited));
  }
  return output;
};

const shouldKeepCompactNode = (node: AxNodeRecord): boolean => {
  if (node.ignored) {
    return false;
  }
  const role = getAxRole(node);
  if (role && INTERACTIVE_AX_ROLES.has(role)) {
    return true;
  }
  const name = getAxName(node);
  const hasName = name.trim().length > 0;
  const hasValue = hasAxValue(node);
  if (hasName || hasValue) {
    return true;
  }
  const hasChildren = Array.isArray(node.childIds) && node.childIds.length > 0;
  if (!role || DECORATIVE_AX_ROLES.has(role)) {
    return false;
  }
  return hasChildren;
};

const compactAxSnapshot = (snapshot: unknown): unknown => {
  const nodes = getAxNodes(snapshot);
  if (nodes.length === 0) {
    return snapshot;
  }
  const nodeById = new Map<string, AxNodeRecord>();
  nodes.forEach((node) => {
    if (node && typeof node.nodeId === 'string') {
      nodeById.set(node.nodeId, node);
    }
  });

  const keepIds = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || typeof node.nodeId !== 'string') {
      continue;
    }
    if (shouldKeepCompactNode(node)) {
      keepIds.add(node.nodeId);
    }
  }

  const filtered = nodes.filter(
    (node) =>
      node && typeof node.nodeId === 'string' && keepIds.has(node.nodeId)
  );

  for (const node of filtered) {
    if (!Array.isArray(node.childIds) || typeof node.nodeId !== 'string') {
      continue;
    }
    const nextChildIds: string[] = [];
    for (const childId of node.childIds) {
      nextChildIds.push(...collectKeptDescendants(childId, nodeById, keepIds));
    }
    node.childIds = Array.from(new Set(nextChildIds));
  }

  return replaceAxNodes(snapshot, filtered);
};

export const applyAxSnapshotFilters = (
  snapshot: unknown,
  options: { interactiveOnly?: boolean; compact?: boolean }
): unknown => {
  let filtered = snapshot;
  if (options.compact) {
    filtered = compactAxSnapshot(filtered);
  }
  if (options.interactiveOnly) {
    filtered = filterAxSnapshot(filtered, (node) => isInteractiveAxNode(node));
  }
  return filtered;
};

export const truncateAxSnapshot = (
  snapshot: unknown,
  maxNodes: number
): { snapshot: unknown; truncated: boolean } => {
  const nodes = getAxNodes(snapshot);
  if (!Number.isFinite(maxNodes) || maxNodes <= 0) {
    return { snapshot, truncated: false };
  }
  if (nodes.length === 0 || nodes.length <= maxNodes) {
    return { snapshot, truncated: false };
  }

  const nodeById = new Map<string, AxNodeRecord>();
  const parentCount = new Map<string, number>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || typeof node.nodeId !== 'string') {
      continue;
    }
    nodeById.set(node.nodeId, node);
    parentCount.set(node.nodeId, parentCount.get(node.nodeId) ?? 0);
  }

  // If the snapshot doesn't have stable node ids, fall back to a hard slice.
  if (nodeById.size === 0) {
    const sliced = nodes.slice(0, maxNodes);
    for (const node of sliced) {
      if (node && typeof node === 'object' && Array.isArray(node.childIds)) {
        node.childIds = [];
      }
    }
    return {
      snapshot: replaceAxNodes(snapshot, sliced),
      truncated: true,
    };
  }

  for (const node of nodes) {
    if (!node || typeof node !== 'object' || !Array.isArray(node.childIds)) {
      continue;
    }
    for (const childId of node.childIds) {
      if (typeof childId !== 'string') {
        continue;
      }
      parentCount.set(childId, (parentCount.get(childId) ?? 0) + 1);
    }
  }

  let roots = Array.from(nodeById.keys()).filter(
    (id) => (parentCount.get(id) ?? 0) === 0
  );
  if (roots.length === 0) {
    const first = nodes.find(
      (node) => node && typeof node.nodeId === 'string'
    )?.nodeId;
    if (first) {
      roots = [first];
    }
  }

  const kept = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [...roots];
  while (queue.length > 0 && kept.size < maxNodes) {
    const id = queue.shift();
    if (!id || visited.has(id)) {
      continue;
    }
    visited.add(id);
    const node = nodeById.get(id);
    if (!node) {
      continue;
    }
    kept.add(id);
    if (Array.isArray(node.childIds)) {
      for (const childId of node.childIds) {
        if (typeof childId === 'string' && !visited.has(childId)) {
          queue.push(childId);
        }
      }
    }
  }

  // As a last resort, keep the first n nodes that have ids.
  if (kept.size === 0) {
    const fallback: string[] = [];
    for (const node of nodes) {
      if (fallback.length >= maxNodes) {
        break;
      }
      if (node && typeof node.nodeId === 'string') {
        fallback.push(node.nodeId);
      }
    }
    fallback.forEach((id) => kept.add(id));
  }

  const filtered = nodes.filter(
    (node) => node && typeof node.nodeId === 'string' && kept.has(node.nodeId)
  );
  for (const node of filtered) {
    if (Array.isArray(node.childIds)) {
      node.childIds = node.childIds.filter(
        (id) => typeof id === 'string' && kept.has(id)
      );
    }
  }

  return {
    snapshot: replaceAxNodes(snapshot, filtered),
    truncated: true,
  };
};
