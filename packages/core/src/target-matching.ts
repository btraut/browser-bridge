export type TargetHint = {
  url?: string;
  title?: string;
  tabId?: number;
  lastActiveAt?: string;
};

export type TargetCandidate = {
  id: string;
  url: string;
  title?: string;
  lastSeenAt?: number;
};

export type RankedTarget = {
  candidate: TargetCandidate;
  score: number;
  reasons: string[];
};

const normalizeText = (value?: string): string =>
  (value ?? '').trim().toLowerCase();

const normalizeUrl = (value?: string): string => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  const hashIndex = normalized.indexOf('#');
  const withoutHash =
    hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  return withoutHash.endsWith('/') && withoutHash.length > 1
    ? withoutHash.slice(0, -1)
    : withoutHash;
};

const scoreUrlMatch = (candidateUrl: string, hintUrl: string): number => {
  if (!candidateUrl || !hintUrl) {
    return 0;
  }
  if (candidateUrl === hintUrl) {
    return 100;
  }
  if (candidateUrl.includes(hintUrl) || hintUrl.includes(candidateUrl)) {
    return 60;
  }
  return 0;
};

const scoreTitleMatch = (candidateTitle: string, hintTitle: string): number => {
  if (!candidateTitle || !hintTitle) {
    return 0;
  }
  if (candidateTitle === hintTitle) {
    return 80;
  }
  if (
    candidateTitle.includes(hintTitle) ||
    hintTitle.includes(candidateTitle)
  ) {
    return 40;
  }
  return 0;
};

const scoreRecency = (lastSeenAt: number | undefined, now: number): number => {
  if (!lastSeenAt) {
    return 0;
  }
  const ageMinutes = Math.max(0, (now - lastSeenAt) / 60000);
  return Math.max(0, 30 - ageMinutes);
};

const scoreHintRecency = (
  lastSeenAt: number | undefined,
  hintLastActiveAt: number | undefined
): number => {
  if (!lastSeenAt || !hintLastActiveAt) {
    return 0;
  }
  const deltaMinutes = Math.abs(lastSeenAt - hintLastActiveAt) / 60000;
  return Math.max(0, 20 - deltaMinutes);
};

const isBlankUrl = (url: string): boolean =>
  url.length === 0 || url === 'about:blank';

export const rankTargetCandidates = (
  candidates: TargetCandidate[],
  hint?: TargetHint,
  now: number = Date.now()
): RankedTarget[] => {
  const normalizedHintUrl = normalizeUrl(hint?.url);
  const normalizedHintTitle = normalizeText(hint?.title);
  const hintLastActiveAt = hint?.lastActiveAt
    ? Date.parse(hint.lastActiveAt)
    : undefined;

  const ranked = candidates.map((candidate) => {
    const reasons: string[] = [];
    const normalizedUrl = normalizeUrl(candidate.url);
    const normalizedTitle = normalizeText(candidate.title);

    let score = 0;
    const urlScore = scoreUrlMatch(normalizedUrl, normalizedHintUrl);
    if (urlScore > 0) {
      score += urlScore;
      reasons.push(urlScore >= 100 ? 'url:exact' : 'url:partial');
    }

    const titleScore = scoreTitleMatch(normalizedTitle, normalizedHintTitle);
    if (titleScore > 0) {
      score += titleScore;
      reasons.push(titleScore >= 80 ? 'title:exact' : 'title:partial');
    }

    const recencyScore = scoreRecency(candidate.lastSeenAt, now);
    if (recencyScore > 0) {
      score += recencyScore;
      reasons.push('recency');
    }

    const hintRecencyScore = scoreHintRecency(
      candidate.lastSeenAt,
      Number.isFinite(hintLastActiveAt) ? hintLastActiveAt : undefined
    );
    if (hintRecencyScore > 0) {
      score += hintRecencyScore;
      reasons.push('hint-recency');
    }

    if (isBlankUrl(normalizedUrl)) {
      score -= 50;
      reasons.push('blank-url');
    }

    return { candidate, score, reasons };
  });

  return ranked.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    const aSeen = a.candidate.lastSeenAt ?? 0;
    const bSeen = b.candidate.lastSeenAt ?? 0;
    if (aSeen !== bSeen) {
      return bSeen - aSeen;
    }
    return a.candidate.url.localeCompare(b.candidate.url);
  });
};

export const pickBestTarget = (
  candidates: TargetCandidate[],
  hint?: TargetHint,
  now: number = Date.now()
): RankedTarget | null => {
  const ranked = rankTargetCandidates(candidates, hint, now);
  return ranked.length > 0 ? ranked[0] : null;
};
