import {
  CONFIRMATION_TIMEOUT_MS,
  ParkingSession,
  canStartSession,
  createDraftSession,
  isActive,
  refreshExpiry,
  remainingMs,
  transition,
} from './session';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function newDraft(): ParkingSession {
  return createDraftSession({
    id: 's1',
    operatorId: 'op1',
    zoneCode: 'a1',
    plate: 'sk-123 ab',
    requestedHours: 2,
    now: T0,
  });
}

function sent(): ParkingSession {
  return transition(newDraft(), { type: 'SMS_SENT', at: T0 + 1000 });
}

function unconfirmed(): ParkingSession {
  return transition(sent(), {
    type: 'CONFIRMATION_TIMED_OUT',
    at: T0 + 1000 + CONFIRMATION_TIMEOUT_MS,
  });
}

function confirmed(endOffset = 120 * MIN): ParkingSession {
  return transition(sent(), {
    type: 'OPERATOR_CONFIRMED',
    at: T0 + 5000,
    endTime: T0 + endOffset,
  });
}

function stopping(): ParkingSession {
  return transition(confirmed(), { type: 'STOP_SENT', at: T0 + 10 * MIN });
}

describe('createDraftSession', () => {
  it('starts as a draft with a normalized plate and zone', () => {
    const s = newDraft();
    expect(s.status).toBe('draft');
    expect(s.plate).toBe('SK123AB');
    expect(s.zoneCode).toBe('A1');
    expect(s.confirmedEndTime).toBeNull();
  });
});

describe('happy path', () => {
  it('goes draft -> sms_sent -> operator_confirmed -> expired', () => {
    const s1 = sent();
    expect(s1.status).toBe('sms_sent');
    const s2 = confirmed();
    expect(s2.status).toBe('operator_confirmed');
    const s3 = refreshExpiry(s2, T0 + 120 * MIN);
    expect(s3.status).toBe('expired');
    expect(s3.endedAt).toBe(T0 + 120 * MIN);
  });
});

describe('rule 1: sms_sent is never paid', () => {
  it('is not active and has no remaining time', () => {
    const s = sent();
    expect(isActive(s, T0 + 2000)).toBe(false);
    expect(remainingMs(s, T0 + 2000)).toBeNull();
  });

  it('is not active while unconfirmed either', () => {
    const s = unconfirmed();
    expect(isActive(s, T0 + 10 * MIN)).toBe(false);
    expect(remainingMs(s, T0 + 10 * MIN)).toBeNull();
  });

  it('is active only once the operator confirmed', () => {
    expect(isActive(confirmed(), T0 + 6000)).toBe(true);
  });
});

describe('rule 2: no skipping, no leaving terminal states', () => {
  it('rejects draft -> operator_confirmed', () => {
    expect(() =>
      transition(newDraft(), { type: 'OPERATOR_CONFIRMED', at: T0, endTime: T0 + MIN }),
    ).toThrow(/Invalid transition/);
  });

  it('rejects stopping before confirmation', () => {
    expect(() => transition(sent(), { type: 'STOP_SENT', at: T0 + 2000 })).toThrow(
      /Invalid transition/,
    );
  });

  it('does not allow leaving failed', () => {
    const failed = transition(newDraft(), { type: 'SEND_FAILED', reason: 'x' });
    expect(() => transition(failed, { type: 'SMS_SENT', at: T0 })).toThrow(/Invalid transition/);
  });

  it('does not allow leaving expired', () => {
    const expired = refreshExpiry(confirmed(), T0 + 200 * MIN);
    expect(() => transition(expired, { type: 'STOP_SENT', at: T0 })).toThrow(/Invalid transition/);
  });
});

describe('confirmation timeout', () => {
  it('rejects a timeout that comes too early', () => {
    expect(() =>
      transition(sent(), { type: 'CONFIRMATION_TIMED_OUT', at: T0 + 2000 }),
    ).toThrow(/has not elapsed/);
  });

  it('moves to unconfirmed after the timeout', () => {
    expect(unconfirmed().status).toBe('unconfirmed');
  });

  it('still accepts a late operator confirmation', () => {
    const s = transition(unconfirmed(), {
      type: 'OPERATOR_CONFIRMED',
      at: T0 + 10 * MIN,
      endTime: T0 + 120 * MIN,
    });
    expect(s.status).toBe('operator_confirmed');
  });

  it('can be rejected by the operator while unconfirmed', () => {
    const s = transition(unconfirmed(), { type: 'OPERATOR_REJECTED', reason: 'bad plate' });
    expect(s.status).toBe('failed');
    expect(s.failureReason).toBe('bad plate');
  });
});

describe('rule 3: time comes from the confirmed end time', () => {
  it('calculates remaining time from the end time, not from elapsed app time', () => {
    const s = confirmed();
    expect(remainingMs(s, T0 + 60 * MIN)).toBe(60 * MIN);
    expect(remainingMs(s, T0 + 119 * MIN)).toBe(MIN);
  });

  it('is active until exactly the end time, then not', () => {
    const s = confirmed();
    expect(isActive(s, T0 + 120 * MIN - 1)).toBe(true);
    expect(isActive(s, T0 + 120 * MIN)).toBe(false);
    expect(remainingMs(s, T0 + 120 * MIN)).toBeNull();
  });

  it('rejects a confirmed end time that is not in the future', () => {
    expect(() =>
      transition(sent(), { type: 'OPERATOR_CONFIRMED', at: T0 + 5000, endTime: T0 + 5000 }),
    ).toThrow(/must be in the future/);
  });
});

describe('refreshExpiry', () => {
  it('returns the same session before the end time', () => {
    const s = confirmed();
    expect(refreshExpiry(s, T0 + MIN)).toBe(s);
  });

  it('is idempotent', () => {
    const once = refreshExpiry(confirmed(), T0 + 200 * MIN);
    expect(refreshExpiry(once, T0 + 300 * MIN)).toBe(once);
  });

  it('does not touch sessions that were never confirmed', () => {
    const s = sent();
    expect(refreshExpiry(s, T0 + 1000 * MIN)).toBe(s);
  });
});

describe('stopping early', () => {
  it('stays active while the stop is unconfirmed', () => {
    const s = stopping();
    expect(s.status).toBe('stopping');
    expect(isActive(s, T0 + 11 * MIN)).toBe(true);
  });

  it('ends when the operator confirms the stop', () => {
    const s = transition(stopping(), { type: 'STOP_CONFIRMED', at: T0 + 11 * MIN });
    expect(s.status).toBe('stopped');
    expect(s.endedAt).toBe(T0 + 11 * MIN);
    expect(isActive(s, T0 + 12 * MIN)).toBe(false);
  });

  it('returns to operator_confirmed if the stop is rejected', () => {
    const s = transition(stopping(), { type: 'STOP_REJECTED' });
    expect(s.status).toBe('operator_confirmed');
    expect(s.stopRequestedAt).toBeNull();
  });

  it('cannot stop a session that has already ended', () => {
    expect(() => transition(confirmed(), { type: 'STOP_SENT', at: T0 + 130 * MIN })).toThrow(
      /already ended/,
    );
  });
});

describe('cancel and send failure', () => {
  it('can cancel a draft', () => {
    expect(transition(newDraft(), { type: 'CANCEL' }).status).toBe('cancelled');
  });

  it('cannot cancel after the SMS was sent', () => {
    expect(() => transition(sent(), { type: 'CANCEL' })).toThrow(/Invalid transition/);
  });

  it('records the reason when sending fails', () => {
    const s = transition(newDraft(), { type: 'SEND_FAILED', reason: 'no permission' });
    expect(s.status).toBe('failed');
    expect(s.failureReason).toBe('no permission');
  });

  it('records the reason when the operator rejects', () => {
    const s = transition(sent(), { type: 'OPERATOR_REJECTED', reason: 'unknown zone' });
    expect(s.status).toBe('failed');
    expect(s.failureReason).toBe('unknown zone');
  });
});

describe('immutability', () => {
  it('does not modify the original session', () => {
    const original = newDraft();
    transition(original, { type: 'SMS_SENT', at: T0 + 1000 });
    expect(original.status).toBe('draft');
    expect(original.smsSentAt).toBeNull();
  });
});

describe('rule 4: duplicate payment prevention', () => {
  const candidate = { operatorId: 'op1', zoneCode: 'a1', plate: 'SK 123 AB' };
  const now = T0 + 10_000;

  it.each([
    ['sms_sent', sent],
    ['unconfirmed', unconfirmed],
    ['operator_confirmed', confirmed],
    ['stopping', stopping],
  ])('blocks a new start while a session is %s', (_name, make) => {
    const result = canStartSession([make()], candidate, now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.blockingSessionId).toBe('s1');
    }
  });

  it('does not block when the previous session is finished or never sent', () => {
    const failed = transition(newDraft(), { type: 'SEND_FAILED', reason: 'x' });
    const cancelled = transition(newDraft(), { type: 'CANCEL' });
    const stopped = transition(stopping(), { type: 'STOP_CONFIRMED', at: T0 + 11 * MIN });
    for (const s of [newDraft(), failed, cancelled, stopped]) {
      expect(canStartSession([s], candidate, T0 + 20 * MIN).allowed).toBe(true);
    }
  });

  it('does not block when the confirmed session has expired by time', () => {
    expect(canStartSession([confirmed()], candidate, T0 + 130 * MIN).allowed).toBe(true);
  });

  it('does not block a different plate, zone or operator', () => {
    const s = confirmed();
    expect(canStartSession([s], { ...candidate, plate: 'SK999ZZ' }, now).allowed).toBe(true);
    expect(canStartSession([s], { ...candidate, zoneCode: 'B2' }, now).allowed).toBe(true);
    expect(canStartSession([s], { ...candidate, operatorId: 'op2' }, now).allowed).toBe(true);
  });
});