import { describe, expect, it } from 'vitest';
import { captureHtml, collectHtmlEntries } from './html-snapshot';

describe('html-snapshot helpers', () => {
  it('collectHtmlEntries indexes tags by id/class', () => {
    const entries = collectHtmlEntries(
      `<div id="root"></div><span class="a b"></span><p></p>`
    );

    expect(entries.has('div#root')).toBe(true);
    expect(entries.has('span.a')).toBe(true);
    expect(Array.from(entries.keys()).some((key) => key.startsWith('p:'))).toBe(
      true
    );
  });

  it('captureHtml returns evaluated HTML', async () => {
    const html = await captureHtml(1, {
      debuggerCommand: async (_tabId, method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { value: '<html></html>' } };
        }
        return {};
      },
      onEvaluationFailed: () => {
        throw new Error('should not be called');
      },
    });

    expect(html).toBe('<html></html>');
  });

  it('captureHtml delegates evaluation failures to caller', async () => {
    await expect(
      captureHtml(1, {
        debuggerCommand: async (_tabId, method) => {
          if (method === 'Runtime.evaluate') {
            return { exceptionDetails: {} };
          }
          return {};
        },
        onEvaluationFailed: () => {
          throw new Error('boom');
        },
      })
    ).rejects.toThrow('boom');
  });
});
