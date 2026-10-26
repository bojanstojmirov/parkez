/**
 * The swappable "send an SMS" component.
 *
 * Contract for every implementation:
 *  - It must NOT throw. Report problems through the result.
 *  - ok:false with mayHaveSent:false means "certainly nothing left the phone".
 *  - ok:false with mayHaveSent:true means "unsure": the caller must assume money may be charged.
 *  - ok:true means the phone accepted the message for sending. It does NOT mean the
 *    operator received it, and it is never proof of payment.
 */

export interface SmsRequest {
  readonly to: string;
  readonly body: string;
}

export type SmsSendResult =
  | { readonly ok: true; readonly sentAt: number }
  | { readonly ok: false; readonly reason: string; readonly mayHaveSent: boolean };

export interface SmsSender {
  /** 'mock' sends nothing real. The UI should show a visible test-mode banner for it. */
  readonly kind: 'mock' | 'compose' | 'direct';
  send(request: SmsRequest): Promise<SmsSendResult>;
}