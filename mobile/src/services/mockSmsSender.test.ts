import { MockSmsSender } from './mockSmsSender';

describe('MockSmsSender', () => {
  it('identifies itself as a mock', () => {
    expect(new MockSmsSender(() => 1).kind).toBe('mock');
  });

  it('succeeds by default and records the attempt', async () => {
    const sender = new MockSmsSender(() => 42);
    const result = await sender.send({ to: '0000', body: 'hello' });
    expect(result).toEqual({ ok: true, sentAt: 42 });
    expect(sender.attempts).toEqual([{ to: '0000', body: 'hello' }]);
  });

  it('returns queued results one at a time, then goes back to success', async () => {
    const sender = new MockSmsSender(() => 1);
    sender.queueResult({ ok: false, reason: 'no signal', mayHaveSent: false });
    const first = await sender.send({ to: 'a', body: 'b' });
    const second = await sender.send({ to: 'a', body: 'b' });
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
  });

  it('throws once when asked to', async () => {
    const sender = new MockSmsSender(() => 1);
    sender.queueThrow(new Error('boom'));
    await expect(sender.send({ to: 'a', body: 'b' })).rejects.toThrow('boom');
    await expect(sender.send({ to: 'a', body: 'b' })).resolves.toEqual({ ok: true, sentAt: 1 });
  });
});