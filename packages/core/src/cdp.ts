import { EventEmitter } from "node:events";
import puppeteer, { Browser, ConnectOptions, LaunchOptions, Page, Target } from "puppeteer";
import { TargetCandidate, TargetHint, rankTargetCandidates } from "./target-matching";

type CdpMode = "auto" | "attach" | "launch";

type BrowserConnection = {
  browser: Browser;
  mode: CdpMode;
  launched: boolean;
};

export type TargetSelection = {
  target: Target;
  page: Page;
  warnings: string[];
  matchedBy?: string[];
};

export type ConsoleEntry = {
  level?: string;
  text?: string;
  timestamp?: string;
};

export class CdpError extends Error {
  public readonly code:
    | "INSPECT_UNAVAILABLE"
    | "CDP_DISCONNECTED"
    | "TARGET_NOT_FOUND";

  constructor(code: CdpError["code"], message: string) {
    super(message);
    this.name = "CdpError";
    this.code = code;
  }
}

const DEFAULT_DEBUG_URL = "http://127.0.0.1:9222";

const resolveChromePath = (): string | undefined =>
  process.env.BROWSER_VISION_CHROME_PATH || process.env.CHROME_PATH || undefined;

const resolveCdpEndpoint = (): { browserWSEndpoint?: string; browserURL?: string } => {
  const wsEndpoint = process.env.BROWSER_VISION_CDP_WS_ENDPOINT;
  const browserURL = process.env.BROWSER_VISION_CDP_URL;
  return {
    browserWSEndpoint: wsEndpoint,
    browserURL,
  };
};

const isPageTarget = (target: Target): boolean => {
  const type = target.type();
  return type === "page" || type === "webview";
};

const getTargetId = (target: Target): string => {
  const maybeTarget = target as { _targetId?: string };
  return maybeTarget._targetId ?? target.url();
};

export class CdpManager extends EventEmitter {
  private browser?: Browser;
  private connecting?: Promise<BrowserConnection>;
  private readonly targetLastSeen = new WeakMap<Target, number>();
  private readonly consoleEntries = new WeakMap<Target, ConsoleEntry[]>();
  private readonly consoleAttached = new WeakSet<Target>();
  private lastConnection?: BrowserConnection;

  async ensureBrowser(mode: CdpMode = "auto"): Promise<BrowserConnection> {
    if (this.browser && this.browser.isConnected()) {
      return {
        browser: this.browser,
        mode: this.lastConnection?.mode ?? mode,
        launched: this.lastConnection?.launched ?? false,
      };
    }

    if (!this.connecting) {
      this.connecting = this.connect(mode).finally(() => {
        this.connecting = undefined;
      });
    }

    const connection = await this.connecting;
    this.lastConnection = connection;
    return connection;
  }

  private async connect(mode: CdpMode): Promise<BrowserConnection> {
    if (mode !== "launch") {
      const attached = await this.tryAttach();
      if (attached) {
        return attached;
      }
      if (mode === "attach") {
        throw new CdpError(
          "INSPECT_UNAVAILABLE",
          "Failed to attach to an existing Chrome instance."
        );
      }
    }

    return this.launchBrowser();
  }

  private async tryAttach(): Promise<BrowserConnection | null> {
    const endpoints = resolveCdpEndpoint();
    const candidates: ConnectOptions[] = [];
    if (endpoints.browserWSEndpoint) {
      candidates.push({ browserWSEndpoint: endpoints.browserWSEndpoint });
    }
    if (endpoints.browserURL) {
      candidates.push({ browserURL: endpoints.browserURL });
    }
    if (!endpoints.browserWSEndpoint && !endpoints.browserURL) {
      candidates.push({ browserURL: DEFAULT_DEBUG_URL });
    }

    for (const options of candidates) {
      try {
        const browser = await puppeteer.connect(options);
        this.registerBrowser(browser);
        return { browser, mode: "attach", launched: false };
      } catch {
        continue;
      }
    }

    return null;
  }

  private async launchBrowser(): Promise<BrowserConnection> {
    const chromePath = resolveChromePath();
    const launchOptions: LaunchOptions = {
      headless: false,
      defaultViewport: null,
      args: ["--no-first-run", "--no-default-browser-check"],
    };
    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }

    const browser = await puppeteer.launch(launchOptions);
    this.registerBrowser(browser);
    return { browser, mode: "launch", launched: true };
  }

  private registerBrowser(browser: Browser): void {
    this.browser = browser;
    browser.on("disconnected", () => {
      this.browser = undefined;
      this.emit("disconnected");
    });
    browser.on("targetcreated", (target) => {
      this.touchTarget(target);
    });
    browser.on("targetchanged", (target) => {
      this.touchTarget(target);
    });
    browser.on("targetdestroyed", (target) => {
      this.targetLastSeen.delete(target);
      this.consoleEntries.delete(target);
      this.consoleAttached.delete(target);
    });
  }

  isConnected(): boolean {
    return Boolean(this.browser && this.browser.isConnected());
  }

  private touchTarget(target: Target): void {
    this.targetLastSeen.set(target, Date.now());
  }

  async listTargets(): Promise<Target[]> {
    if (!this.browser || !this.browser.isConnected()) {
      throw new CdpError("CDP_DISCONNECTED", "CDP is not connected.");
    }

    const targets = this.browser.targets().filter(isPageTarget);
    targets.forEach((target) => this.touchTarget(target));
    return targets;
  }

  async getPageForTarget(target: Target): Promise<Page> {
    const page = await target.page();
    if (page) {
      return page;
    }
    return await target.asPage();
  }

  async ensureConsoleCapture(target: Target, page: Page): Promise<void> {
    if (this.consoleAttached.has(target)) {
      return;
    }

    const entries = this.consoleEntries.get(target) ?? [];
    const pushEntry = (entry: ConsoleEntry) => {
      entries.push(entry);
      if (entries.length > 200) {
        entries.shift();
      }
    };

    page.on("console", (message) => {
      pushEntry({
        level: message.type(),
        text: message.text(),
        timestamp: new Date().toISOString(),
      });
    });

    page.on("pageerror", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      pushEntry({
        level: "error",
        text: message,
        timestamp: new Date().toISOString(),
      });
    });

    page.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      pushEntry({
        level: "error",
        text: message,
        timestamp: new Date().toISOString(),
      });
    });

    this.consoleEntries.set(target, entries);
    this.consoleAttached.add(target);
  }

  getConsoleEntries(target: Target): ConsoleEntry[] {
    return this.consoleEntries.get(target) ?? [];
  }

  async selectTarget(hint?: TargetHint): Promise<TargetSelection> {
    const targets = await this.listTargets();
    if (targets.length === 0) {
      throw new CdpError("TARGET_NOT_FOUND", "No page targets available.");
    }

    const candidates: TargetCandidate[] = [];
    for (const target of targets) {
      const page = await target.page();
      let title: string | undefined;
      if (page) {
        try {
          title = await page.title();
        } catch {
          title = undefined;
        }
      }
      candidates.push({
        id: getTargetId(target),
        url: target.url(),
        title,
        lastSeenAt: this.targetLastSeen.get(target),
      });
    }

    const ranked = rankTargetCandidates(candidates, hint);
    const warnings: string[] = [];

    const tryOrder = ranked.length > 1 ? [ranked[0], ranked[1]] : [ranked[0]];

    let bestTarget: Target | null = null;
    let bestPage: Page | null = null;

    for (const rank of tryOrder) {
      const target = targets.find((entry) => getTargetId(entry) === rank.candidate.id);
      if (!target) {
        continue;
      }
      const page = await this.getPageForTarget(target);
      if (await this.verifyTarget(page, hint)) {
        return {
          target,
          page,
          warnings,
          matchedBy: rank.reasons,
        };
      }

      if (!bestTarget) {
        bestTarget = target;
        bestPage = page;
      }
    }

    if (hint?.url || hint?.title) {
      warnings.push("Target verification mismatch; proceeding with best match.");
    }

    if (!bestTarget || !bestPage) {
      const fallbackTarget = targets[0];
      return {
        target: fallbackTarget,
        page: await this.getPageForTarget(fallbackTarget),
        warnings,
        matchedBy: ranked[0]?.reasons,
      };
    }

    return { target: bestTarget, page: bestPage, warnings, matchedBy: ranked[0]?.reasons };
  }

  private async verifyTarget(page: Page, hint?: TargetHint): Promise<boolean> {
    if (!hint?.url && !hint?.title) {
      return true;
    }

    try {
      const snapshot = await page.evaluate(() => {
        const global = globalThis as unknown as {
          location: { href: string };
          document: { title: string };
        };
        return {
          url: global.location.href,
          title: global.document.title,
        };
      });

      if (hint.url && snapshot.url !== hint.url) {
        return false;
      }
      if (hint.title && snapshot.title !== hint.title) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}
