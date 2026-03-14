import { findByText, scoreCandidates } from './locator-ranking.js';

export const SNAPSHOT_REF_REGISTRY_ID = '__bb_snapshot_ref_registry__';

export type SnapshotRefMetadata = {
  role?: string;
  name?: string;
  url?: string;
};

export const readSnapshotRefRegistry = (): Map<string, SnapshotRefMetadata> => {
  const registry = new Map<string, SnapshotRefMetadata>();
  const el = document.getElementById(SNAPSHOT_REF_REGISTRY_ID);
  const raw = el?.textContent;
  if (!raw) {
    return registry;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return registry;
    }
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const ref = (entry as { ref?: unknown }).ref;
      if (typeof ref !== 'string' || ref.length === 0) {
        continue;
      }
      registry.set(ref, {
        role:
          typeof (entry as { role?: unknown }).role === 'string'
            ? ((entry as { role?: string }).role ?? undefined)
            : undefined,
        name:
          typeof (entry as { name?: unknown }).name === 'string'
            ? ((entry as { name?: string }).name ?? undefined)
            : undefined,
        url:
          typeof (entry as { url?: unknown }).url === 'string'
            ? ((entry as { url?: string }).url ?? undefined)
            : undefined,
      });
    }
  } catch {
    return new Map();
  }
  return registry;
};

// Recovery is deliberately best-effort. We only persist metadata for refs that
// rebound into the live DOM during snapshot capture, then try to recover in the
// same order the existing UI proved reliable on rerendered link lists: exact
// url/text link match first, then role/name, then plain text.
export const recoverElementBySnapshotRef = (
  ref: string,
  options: {
    findByRole: (locator: Record<string, unknown>) => Element | null;
  }
): Element | null => {
  const metadata = readSnapshotRefRegistry().get(ref);
  if (!metadata) {
    return null;
  }

  if (typeof metadata.url === 'string' && metadata.url.length > 0) {
    const linkCandidates = Array.from(
      document.querySelectorAll('a[href],[role="link"]')
    );
    const bestLink = scoreCandidates(linkCandidates, {
      exactHref: metadata.url,
      exactText: metadata.name,
    });
    if (bestLink) {
      return bestLink;
    }
  }

  if (typeof metadata.role === 'string' && metadata.role.length > 0) {
    const roleMatch = options.findByRole({
      role: {
        name: metadata.role,
        ...(metadata.name ? { value: metadata.name } : {}),
      },
    });
    if (roleMatch) {
      return roleMatch;
    }
  }

  if (typeof metadata.name === 'string' && metadata.name.length > 0) {
    return findByText(metadata.name);
  }

  return null;
};
