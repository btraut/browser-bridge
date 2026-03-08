import type { DriveErrorInfo } from './protocol.js';

export const RESTRICTED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'chrome-devtools://',
  'devtools://',
  'edge://',
  'brave://',
  'view-source:',
];

export const isRestrictedUrl = (url?: string): boolean => {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const lowered = url.toLowerCase();
  if (RESTRICTED_URL_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return true;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'chromewebstore.google.com') {
      return true;
    }
    if (parsed.hostname === 'chrome.google.com') {
      return parsed.pathname.startsWith('/webstore');
    }
  } catch (error) {
    console.debug('Ignoring invalid URL in restriction check.', error);
  }
  return false;
};

type RestrictedOperation = 'navigate' | 'screenshot' | 'debugger' | 'action';

const getRestrictedUrlKind = (url: string): string => {
  const lowered = url.toLowerCase();
  if (lowered.startsWith('chrome-extension://')) {
    return 'extension_internal';
  }
  if (
    lowered.startsWith('chrome://') ||
    lowered.startsWith('edge://') ||
    lowered.startsWith('brave://')
  ) {
    return 'browser_internal';
  }
  if (
    lowered.includes('chromewebstore.google.com') ||
    lowered.includes('chrome.google.com/webstore')
  ) {
    return 'webstore';
  }
  return 'restricted_url';
};

const getAlternativeCommands = (url: string): string[] => {
  const lowered = url.toLowerCase();
  const commands = [
    'browser-bridge dev info',
    'browser-bridge diagnostics doctor',
  ];
  if (
    lowered.startsWith('chrome-extension://') ||
    lowered.startsWith('chrome://extensions')
  ) {
    commands.unshift('browser-bridge dev enable-inspect --extension-id <id>');
  }
  return commands;
};

export const buildRestrictedUrlError = (options: {
  url: string;
  operation: RestrictedOperation;
  action?: string;
}): DriveErrorInfo => {
  const alternatives = getAlternativeCommands(options.url);
  const operationLabel =
    options.operation === 'navigate'
      ? 'Navigation'
      : options.operation === 'screenshot'
        ? 'Screenshots'
        : options.operation === 'debugger'
          ? 'Debugger attach'
          : 'This action';

  return {
    code: 'NOT_SUPPORTED',
    message: `${operationLabel} is not supported for browser internal URLs.`,
    retryable: false,
    details: {
      reason: 'restricted_internal_url',
      url: options.url,
      url_kind: getRestrictedUrlKind(options.url),
      rationale:
        'Chrome restricts extension automation on internal browser surfaces (for example chrome:// and chrome-extension://).',
      action: options.action,
      next_step: alternatives[0],
      alternatives,
    },
  };
};
