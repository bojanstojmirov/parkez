import { formatRemaining, statusLabel } from './format';
import { SessionStatus } from './session';

describe('formatRemaining', () => {
  it('formats minutes and seconds', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(59_000)).toBe('00:59');
    expect(formatRemaining(61_000)).toBe('01:01');
  });

  it('formats hours', () => {
    expect(formatRemaining(3_661_000)).toBe('1:01:01');
  });

  it('rounds partial seconds up', () => {
    expect(formatRemaining(1)).toBe('00:01');
  });

  it('never goes negative', () => {
    expect(formatRemaining(-5_000)).toBe('00:00');
  });
});

describe('statusLabel', () => {
  const all: SessionStatus[] = [
    'draft', 'sms_sent', 'unconfirmed', 'operator_confirmed', 'stopping',
    'stopped', 'expired', 'failed', 'cancelled',
  ];

  it('has a non-empty label for every status', () => {
    for (const status of all) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
    }
  });

  it('says "not confirmed" for statuses that are not confirmed', () => {
    expect(statusLabel('sms_sent')).toMatch(/not confirmed/);
    expect(statusLabel('unconfirmed')).toMatch(/not confirmed/);
  });
});