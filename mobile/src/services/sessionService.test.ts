import { OperatorProfile } from '../domain/operators';
import { ReplyParser, UnrecognizedReplyParser } from '../domain/replyParser';
import { isActive, remainingMs } from '../domain/session';
import { MockSmsSender } from './mockSmsSender';
import { SessionService } from './sessionService';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const zone = (code: string, maxMinutes: number | null) => ({
  code,
  maxMinutes,
  pricePerHourDenars: null,
  lastVerified: null,
  source: null,
});

// TEST FIXTURES ONLY: not real operator data.
const PREPAID: OperatorProfile = {
  id: 'prepaid',
  displayName: 'Test prepaid',
  smsNumber: '1111',
  paymentModel: 'prepaid_hours',
  separator: ' ',
  stopKeyword: null,
  zones: [zone('T1', 120), zone('T2', 60)],
};

const OPEN: OperatorProfile = {
  id: 'open',
  displayName: 'Test open',
  smsNumber: '2222',
  paymentModel: 'open_until_stop',
  separator: ' ',
  stopKeyword: 'S',
  zones: [zone('T3', 240)],
};

// TEST-ONLY reply format. Real operator formats are unknown.
const fakeParser: ReplyParser = {
  parse(text: string) {
    const [head, ...rest] = text.trim().split(' ');
    if (head === 'OK') return { kind: 'confirmed', endTime: Number(rest[0]) };
    if (head === 'NO') return { kind: 'rejected', reason: rest.join(' ') };
    if (head === 'STOPPED') return { kind: 'stop_confirmed' };
    return { kind: 'unrecognized' };
  },
};

function setup() {
  let t = T0;
  let counter = 0;
  const now = () => t;
  const sender = new MockSmsSender(now);
  const service = new SessionService({
    sender,
    parser: fakeParser,
    operators: [PREPAID, OPEN],
    now,
    newId: () => `id${++counter}`,
  });
  return {
    service,
    sender,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const prepaidStart = { operatorId: 'prepaid', zoneCode: 'T1', plate: 'SK123AB', hours: 1 };
const openStart = { operatorId: 'open', zoneCode: 'T3', plate: 'SK123AB' };

describe('startSession', () => {
  it('sends exactly one SMS and ends in sms_sent, which is not active', async () => {
    const { service, sender } = setup();
    const result = await service.startSession(prepaidStart);
    expect(result.ok).toBe(true);
    expect(sender.attempts).toEqual([{ to: '1111', body: 'T1 SK123AB 1' }]);
    const session = service.getSessions()[0];
    expect(session?.status).toBe('sms_sent');
    expect(session && isActive(session, T0)).toBe(false);
  });

  it('rejects invalid input without sending anything or storing a session', async () => {
    const { service, sender } = setup();
    const bad = [
      { ...prepaidStart, operatorId: 'nope' },
      { ...prepaidStart, plate: 'x' },
      { ...prepaidStart, zoneCode: 'ZZ' },
      { ...prepaidStart, zoneCode: 'T2', hours: 2 },
      { ...prepaidStart, hours: undefined },
    ];
    for (const params of bad) {
      const result = await service.startSession(params);
      expect(result.ok).toBe(false);
    }
    expect(sender.attempts).toHaveLength(0);
    expect(service.getSessions()).toHaveLength(0);
  });

  it('marks the session failed when the sender is sure nothing was sent, and allows a retry', async () => {
    const { service, sender } = setup();
    sender.queueResult({ ok: false, reason: 'no permission', mayHaveSent: false });
    const first = await service.startSession(prepaidStart);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.session?.status).toBe('failed');
      expect(first.reason).toBe('no permission');
    }
    const retry = await service.startSession(prepaidStart);
    expect(retry.ok).toBe(true);
    expect(sender.attempts).toHaveLength(2);
  });

  it('assumes the SMS may have left when the sender is unsure', async () => {
    const { service, sender } = setup();
    sender.queueResult({ ok: false, reason: 'callback timed out', mayHaveSent: true });
    const result = await service.startSession(prepaidStart);
    expect(result.ok).toBe(true);
    expect(service.getSessions()[0]?.status).toBe('sms_sent');
  });

  it('treats a sender that throws as possibly sent', async () => {
    const { service, sender } = setup();
    sender.queueThrow(new Error('boom'));
    const result = await service.startSession(prepaidStart);
    expect(result.ok).toBe(true);
    expect(service.getSessions()[0]?.status).toBe('sms_sent');
  });
});

describe('duplicate payment prevention', () => {
  it('blocks a second start while the first is pending', async () => {
    const { service, sender } = setup();
    await service.startSession(prepaidStart);
    const second = await service.startSession(prepaidStart);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/already/);
    expect(sender.attempts).toHaveLength(1);
  });

  it('blocks a double tap: two simultaneous starts send only one SMS', async () => {
    const { service, sender } = setup();
    const results = await Promise.all([
      service.startSession(prepaidStart),
      service.startSession(prepaidStart),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(sender.attempts).toHaveLength(1);
  });

  it('allows different plates at the same time', async () => {
    const { service, sender } = setup();
    await service.startSession(prepaidStart);
    const other = await service.startSession({ ...prepaidStart, plate: 'SK999ZZ' });
    expect(other.ok).toBe(true);
    expect(sender.attempts).toHaveLength(2);
  });
});

describe('applyReply', () => {
  it('confirms a session and makes it active with remaining time from the end time', async () => {
    const { service, advance } = setup();
    await service.startSession(prepaidStart);
    const id = service.getSessions()[0]!.id;
    advance(5_000);
    const result = service.applyReply(id, `OK ${T0 + 60 * MIN}`);
    expect(result.ok).toBe(true);
    const session = service.getSession(id)!;
    expect(session.status).toBe('operator_confirmed');
    expect(isActive(session, T0 + 5_000)).toBe(true);
    expect(remainingMs(session, T0 + 30 * MIN)).toBe(30 * MIN);
  });

  it('leaves the session unchanged for unrecognized replies', async () => {
    const { service } = setup();
    await service.startSession(prepaidStart);
    const id = service.getSessions()[0]!.id;
    const result = service.applyReply(id, 'hello there');
    expect(result.ok).toBe(false);
    expect(service.getSession(id)?.status).toBe('sms_sent');
  });

  it('refuses a confirmation whose end time is already in the past', async () => {
    const { service } = setup();
    await service.startSession(prepaidStart);
    const id = service.getSessions()[0]!.id;
    const result = service.applyReply(id, `OK ${T0 - MIN}`);
    expect(result.ok).toBe(false);
    expect(service.getSession(id)?.status).toBe('sms_sent');
  });

  it('marks the session failed when the operator rejects it', async () => {
    const { service } = setup();
    await service.startSession(prepaidStart);
    const id = service.getSessions()[0]!.id;
    service.applyReply(id, 'NO unknown zone');
    const session = service.getSession(id)!;
    expect(session.status).toBe('failed');
    expect(session.failureReason).toBe('unknown zone');
  });

  it('never confirms anything with the default UnrecognizedReplyParser', async () => {
    let t = T0;
    const service = new SessionService({
      sender: new MockSmsSender(() => t),
      parser: new UnrecognizedReplyParser(),
      operators: [PREPAID],
      now: () => t,
      newId: () => 'x1',
    });
    await service.startSession(prepaidStart);
    const result = service.applyReply('x1', `OK ${t + 60 * MIN}`);
    expect(result.ok).toBe(false);
    expect(service.getSession('x1')?.status).toBe('sms_sent');
  });

  it('reports an unknown session id', () => {
    const { service } = setup();
    expect(service.applyReply('missing', 'OK 1').ok).toBe(false);
  });
});

describe('refresh: timeouts and expiry', () => {
  it('moves to unconfirmed only after the timeout', async () => {
    const { service, advance } = setup();
    await service.startSession(prepaidStart);
    advance(2 * MIN);
    service.refresh();
    expect(service.getSessions()[0]?.status).toBe('sms_sent');
    advance(MIN);
    service.refresh();
    expect(service.getSessions()[0]?.status).toBe('unconfirmed');
  });

  it('still accepts a late confirmation after unconfirmed', async () => {
    const { service, advance } = setup();
    await service.startSession(prepaidStart);
    const id = service.getSessions()[0]!.id;
    advance(10 * MIN);
    service.refresh();
    const result = service.applyReply(id, `OK ${T0 + 70 * MIN}`);
    expect(result.ok).toBe(true);
    expect(service.getSession(id)?.status).toBe('operator_confirmed');
  });

  it('expires a confirmed session once the end time has passed', async () => {
    const { service, advance } = setup();
    await service.startSession(prepaidStart);
    const id = service.getSessions()[0]!.id;
    service.applyReply(id, `OK ${T0 + 60 * MIN}`);
    advance(61 * MIN);
    service.refresh();
    expect(service.getSession(id)?.status).toBe('expired');
  });

  it('keeps blocking duplicates while unconfirmed', async () => {
    const { service, advance } = setup();
    await service.startSession(prepaidStart);
    advance(10 * MIN);
    service.refresh();
    const again = await service.startSession(prepaidStart);
    expect(again.ok).toBe(false);
  });
});

describe('stopSession', () => {
  async function confirmedOpenSession() {
    const ctx = setup();
    await ctx.service.startSession(openStart);
    const id = ctx.service.getSessions()[0]!.id;
    ctx.service.applyReply(id, `OK ${T0 + 240 * MIN}`);
    return { ...ctx, id };
  }

  it('sends the stop keyword and moves to stopping, then stopped on confirmation', async () => {
    const { service, sender, id } = await confirmedOpenSession();
    const result = await service.stopSession(id);
    expect(result.ok).toBe(true);
    expect(sender.attempts[1]).toEqual({ to: '2222', body: 'S' });
    expect(service.getSession(id)?.status).toBe('stopping');
    service.applyReply(id, 'STOPPED');
    expect(service.getSession(id)?.status).toBe('stopped');
  });

  it('returns to operator_confirmed when the stop is rejected', async () => {
    const { service, id } = await confirmedOpenSession();
    await service.stopSession(id);
    service.applyReply(id, 'NO cannot stop');
    expect(service.getSession(id)?.status).toBe('operator_confirmed');
  });

  it('stays confirmed if the stop SMS certainly did not send', async () => {
    const { service, sender, id } = await confirmedOpenSession();
    sender.queueResult({ ok: false, reason: 'no signal', mayHaveSent: false });
    const result = await service.stopSession(id);
    expect(result.ok).toBe(false);
    expect(service.getSession(id)?.status).toBe('operator_confirmed');
  });

  it('sends only one stop SMS on a double tap', async () => {
    const { service, sender, id } = await confirmedOpenSession();
    const results = await Promise.all([service.stopSession(id), service.stopSession(id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(sender.attempts).toHaveLength(2);
  });

  it('refuses to stop a session that is not confirmed', async () => {
    const { service, sender } = setup();
    await service.startSession(openStart);
    const id = service.getSessions()[0]!.id;
    const result = await service.stopSession(id);
    expect(result.ok).toBe(false);
    expect(sender.attempts).toHaveLength(1);
  });

  it('refuses to stop for operators without a stop keyword', async () => {
    const { service, sender } = setup();
    await service.startSession(prepaidStart);
    const id = service.getSessions()[0]!.id;
    service.applyReply(id, `OK ${T0 + 60 * MIN}`);
    const result = await service.stopSession(id);
    expect(result.ok).toBe(false);
    expect(sender.attempts).toHaveLength(1);
  });

  it('reports an unknown session id', async () => {
    const { service } = setup();
    expect((await service.stopSession('missing')).ok).toBe(false);
  });
});