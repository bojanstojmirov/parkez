import { SmsRequest, SmsSendResult, SmsSender } from './smsSender';

/**
 * A fake sender for development and tests. It never sends a real SMS and never costs money.
 * By default every send succeeds. Use queueResult/queueThrow to simulate problems.
 */
export class MockSmsSender implements SmsSender {
  readonly kind = 'mock' as const;

  private readonly log: SmsRequest[] = [];
  private readonly queuedResults: SmsSendResult[] = [];
  private queuedError: Error | null = null;

  constructor(private readonly now: () => number) {}

  /** Every message the app asked this sender to send, in order. */
  get attempts(): readonly SmsRequest[] {
    return this.log;
  }

  /** The next send() call returns this result (one-shot, queued in order). */
  queueResult(result: SmsSendResult): void {
    this.queuedResults.push(result);
  }

  /** The next send() call throws this error (to test misbehaving senders). */
  queueThrow(error: Error): void {
    this.queuedError = error;
  }

  async send(request: SmsRequest): Promise<SmsSendResult> {
    this.log.push(request);

    if (this.queuedError !== null) {
      const error = this.queuedError;
      this.queuedError = null;
      throw error;
    }

    const queued = this.queuedResults.shift();
    return queued ?? { ok: true, sentAt: this.now() };
  }
}