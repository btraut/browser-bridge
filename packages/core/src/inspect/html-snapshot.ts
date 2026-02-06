import type { DebuggerCommand } from './snapshot-refs';

export const captureHtml = async (
  tabId: number,
  options: {
    selector?: string;
    debuggerCommand: DebuggerCommand;
    onEvaluationFailed: () => never;
  }
): Promise<string> => {
  await options.debuggerCommand(tabId, 'Runtime.enable', {});
  const expression = options.selector
    ? `(() => { try { const el = document.querySelector(${JSON.stringify(
        options.selector
      )}); return el ? el.outerHTML : ""; } catch { return ""; } })()`
    : "document.documentElement ? document.documentElement.outerHTML : ''";
  const result = await options.debuggerCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (result && typeof result === 'object' && 'exceptionDetails' in result) {
    return options.onEvaluationFailed();
  }

  return String(
    (result as { result?: { value?: unknown } })?.result?.value ?? ''
  );
};

export const collectHtmlEntries = (html: string): Map<string, string> => {
  const entries = new Map<string, string>();
  const tagPattern = /<([a-zA-Z0-9-]+)([^>]*)>/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = tagPattern.exec(html)) && entries.size < 1000) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] ?? '';
    const idMatch = /\bid=["']([^"']+)["']/.exec(attrs);
    const classMatch = /\bclass=["']([^"']+)["']/.exec(attrs);
    const id = idMatch?.[1];
    const className = classMatch?.[1]?.split(/\s+/)[0];
    let key = tag;
    if (id) {
      key = `${tag}#${id}`;
    } else if (className) {
      key = `${tag}.${className}`;
    } else {
      key = `${tag}:nth-${index}`;
    }
    entries.set(key, attrs.trim());
    index += 1;
  }
  return entries;
};
