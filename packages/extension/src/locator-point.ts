export const pointHitsTarget = (
  target: Element,
  x: number,
  y: number,
  options?: { directOnly?: boolean }
): boolean => {
  if (typeof document.elementFromPoint !== 'function') {
    return true;
  }
  const hit = document.elementFromPoint(x, y);
  if (!hit) {
    return false;
  }
  if (options?.directOnly) {
    return target === hit;
  }
  return target === hit || target.contains(hit);
};

export const getHittablePoint = (
  target: Element,
  options?: { preferDirectHit?: boolean }
): { x: number; y: number } => {
  const rect = target.getBoundingClientRect();
  const insetX = Math.min(Math.max(rect.width * 0.25, 1), rect.width / 2);
  const insetY = Math.min(Math.max(rect.height * 0.25, 1), rect.height / 2);
  const candidatePoints = [
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    { x: rect.left + insetX, y: rect.top + insetY },
    { x: rect.right - insetX, y: rect.top + insetY },
    { x: rect.left + insetX, y: rect.bottom - insetY },
    { x: rect.right - insetX, y: rect.bottom - insetY },
    { x: rect.left + rect.width / 2, y: rect.top + insetY },
    { x: rect.left + rect.width / 2, y: rect.bottom - insetY },
    { x: rect.left + insetX, y: rect.top + rect.height / 2 },
    { x: rect.right - insetX, y: rect.top + rect.height / 2 },
  ];
  if (options?.preferDirectHit) {
    for (const point of candidatePoints) {
      if (pointHitsTarget(target, point.x, point.y, { directOnly: true })) {
        return point;
      }
    }
  }
  for (const point of candidatePoints) {
    if (pointHitsTarget(target, point.x, point.y)) {
      return point;
    }
  }
  return candidatePoints[0] ?? { x: rect.left, y: rect.top };
};
