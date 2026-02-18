import { describe, expect, it } from 'vitest';
import {
  getTabChannelRetryDelayMs,
  isLikelyNavigationCommitted,
  isTransientTabChannelError,
} from './drive-reliability';

describe('drive reliability helpers', () => {
  it('detects transient tab channel errors', () => {
    expect(
      isTransientTabChannelError(
        'Could not establish connection. Receiving end does not exist.'
      )
    ).toBe(true);
    expect(
      isTransientTabChannelError(
        'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'
      )
    ).toBe(true);
    expect(
      isTransientTabChannelError(
        'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.'
      )
    ).toBe(true);
    expect(isTransientTabChannelError('tab not found')).toBe(false);
  });

  it('returns bounded retry delays for sequential attempts', () => {
    expect(getTabChannelRetryDelayMs(1)).toBe(120);
    expect(getTabChannelRetryDelayMs(4)).toBe(500);
    expect(getTabChannelRetryDelayMs(7)).toBe(1200);
    expect(getTabChannelRetryDelayMs(8)).toBeUndefined();
  });

  it('matches likely successful navigation URLs', () => {
    expect(
      isLikelyNavigationCommitted(
        'http://127.0.0.1:3115',
        'http://127.0.0.1:3115/'
      )
    ).toBe(true);
    expect(
      isLikelyNavigationCommitted(
        'http://127.0.0.1:3115?a=1',
        'http://127.0.0.1:3115/?a=1'
      )
    ).toBe(true);
    expect(
      isLikelyNavigationCommitted(
        'http://127.0.0.1:3115?a=1',
        'http://127.0.0.1:3115/?a=2'
      )
    ).toBe(false);
  });
});
