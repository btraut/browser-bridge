import { describe, expect, it } from "vitest";
import { pickBestTarget, rankTargetCandidates, TargetCandidate } from "./target-matching";

describe("target matching", () => {
  const now = new Date("2025-01-01T12:00:00.000Z").getTime();

  it("prefers exact URL match over recency", () => {
    const candidates: TargetCandidate[] = [
      {
        id: "a",
        url: "https://example.com/path",
        title: "Example",
        lastSeenAt: now - 10 * 60 * 1000,
      },
      {
        id: "b",
        url: "https://recent.com/",
        title: "Recent",
        lastSeenAt: now - 30 * 1000,
      },
    ];

    const best = pickBestTarget(candidates, {
      url: "https://example.com/path",
    }, now);

    expect(best?.candidate.id).toBe("a");
  });

  it("uses title match when URL hint missing", () => {
    const candidates: TargetCandidate[] = [
      {
        id: "a",
        url: "https://alpha.com",
        title: "Alpha Project",
        lastSeenAt: now - 2 * 60 * 1000,
      },
      {
        id: "b",
        url: "https://beta.com",
        title: "Beta Dashboard",
        lastSeenAt: now - 30 * 1000,
      },
    ];

    const best = pickBestTarget(candidates, {
      title: "Alpha Project",
    }, now);

    expect(best?.candidate.id).toBe("a");
  });

  it("falls back to most recent when no hints", () => {
    const candidates: TargetCandidate[] = [
      {
        id: "a",
        url: "https://older.com",
        title: "Older",
        lastSeenAt: now - 5 * 60 * 1000,
      },
      {
        id: "b",
        url: "https://newer.com",
        title: "Newer",
        lastSeenAt: now - 15 * 1000,
      },
    ];

    const ranked = rankTargetCandidates(candidates, undefined, now);

    expect(ranked[0]?.candidate.id).toBe("b");
  });

  it("allows partial URL matches", () => {
    const candidates: TargetCandidate[] = [
      {
        id: "a",
        url: "https://example.com/path/sub",
        title: "Example Sub",
        lastSeenAt: now - 60 * 1000,
      },
      {
        id: "b",
        url: "https://other.com",
        title: "Other",
        lastSeenAt: now - 30 * 1000,
      },
    ];

    const best = pickBestTarget(candidates, {
      url: "https://example.com/path",
    }, now);

    expect(best?.candidate.id).toBe("a");
  });
});
