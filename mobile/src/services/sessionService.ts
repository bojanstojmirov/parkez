/**
 * Coordinates operators, the SMS sender, the reply parser and the session state machine.
 * Sessions are kept in memory only (persistence comes in a later step).
 */
import {
  OperatorProfile,
  buildStartMessage,
  buildStopMessage,
} from '../domain/operators';
import { ReplyParser } from '../domain/replyParser';
import {
  CONFIRMATION_TIMEOUT_MS,
  ParkingSession,
  canStartSession,
  createDraftSession,
  refreshExpiry,
  transition,
} from '../domain/session';
import { SmsRequest, SmsSendResult, SmsSender } from './smsSender';

export interface SessionServiceDeps {
  readonly sender: SmsSender;
  readonly parser: ReplyParser;
  readonly operators: readonly OperatorProfile[];
  /** Current time in epoch ms. Injected so tests control time. */
  readonly now: () => number;
  readonly newId: () => string;
}

export type ServiceResult =
  | { readonly ok: true; readonly session: ParkingSession }
  | { readonly ok: false; readonly reason: string; readonly session?: ParkingSession };

export interface StartParams {
  readonly operatorId: string;
  readonly zoneCode: string;
  readonly plate: string;
  readonly hours?: number;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class SessionService {
  private sessions: readonly ParkingSession[] = [];
  /** Start requests currently being sent. Filled BEFORE any await, so double taps are caught. */
  private readonly startsInFlight = new Set<string>();
  private readonly stopsInFlight = new Set<string>();

  constructor(private readonly deps: SessionServiceDeps) {}

  getSessions(): readonly ParkingSession[] {
    return this.sessions;
  }

  getSession(id: string): ParkingSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  async startSession(params: StartParams): Promise<ServiceResult> {
    const operator = this.deps.operators.find((o) => o.id === params.operatorId);
    if (!operator) {
      return { ok: false, reason: `Unknown operator "${params.operatorId}"` };
    }

    const now = this.deps.now();
    let body: string;
    let draft: ParkingSession;
    try {
      body = buildStartMessage(operator, params.zoneCode, params.plate, params.hours);
      draft = createDraftSession({
        id: this.deps.newId(),
        operatorId: operator.id,
        zoneCode: params.zoneCode,
        plate: params.plate,
        requestedHours: params.hours ?? null,
        now,
      });
    } catch (e: unknown) {
      return { ok: false, reason: errorMessage(e) };
    }

    const key = `${draft.operatorId}|${draft.zoneCode}|${draft.plate}`;
    if (this.startsInFlight.has(key)) {
      return { ok: false, reason: 'A start request for this vehicle and zone is already in progress' };
    }
    const check = canStartSession(
      this.sessions,
      { operatorId: draft.operatorId, zoneCode: draft.zoneCode, plate: draft.plate },
      now,
    );
    if (!check.allowed) {
      return { ok: false, reason: check.reason };
    }

    // No await above this line: the guard is in place before anything can interleave.
    this.startsInFlight.add(key);
    this.upsert(draft);
    try {
      const result = await this.sendSafely({ to: operator.smsNumber, body });

      let next: ParkingSession;
      if (result.ok) {
        next = transition(draft, { type: 'SMS_SENT', at: result.sentAt });
      } else if (result.mayHaveSent) {
        // Unsure whether the SMS left: assume it did, so no second paid SMS is sent blindly.
        next = transition(draft, { type: 'SMS_SENT', at: this.deps.now() });
      } else {
        next = transition(draft, { type: 'SEND_FAILED', reason: result.reason });
      }
      this.upsert(next);

      if (next.status === 'failed') {
        return { ok: false, reason: next.failureReason ?? 'Send failed', session: next };
      }
      return { ok: true, session: next };
    } finally {
      this.startsInFlight.delete(key);
    }
  }

  /** Sends the stop keyword for a confirmed session (operators that support stopping only). */
  async stopSession(sessionId: string): Promise<ServiceResult> {
    this.refresh();
    const session = this.getSession(sessionId);
    if (!session) {
      return { ok: false, reason: `Unknown session "${sessionId}"` };
    }
    if (session.status !== 'operator_confirmed') {
      return { ok: false, reason: `Cannot stop a session in status ${session.status}`, session };
    }
    if (this.stopsInFlight.has(sessionId)) {
      return { ok: false, reason: 'A stop request is already in progress', session };
    }
    const operator = this.deps.operators.find((o) => o.id === session.operatorId);
    if (!operator) {
      return { ok: false, reason: `Unknown operator "${session.operatorId}"`, session };
    }
    let body: string;
    try {
      body = buildStopMessage(operator);
    } catch (e: unknown) {
      return { ok: false, reason: errorMessage(e), session };
    }

    this.stopsInFlight.add(sessionId);
    try {
      const result = await this.sendSafely({ to: operator.smsNumber, body });
      if (!result.ok && !result.mayHaveSent) {
        return { ok: false, reason: result.reason, session };
      }
      const current = this.getSession(sessionId) ?? session;
      try {
        const next = transition(current, { type: 'STOP_SENT', at: this.deps.now() });
        this.upsert(next);
        return { ok: true, session: next };
      } catch (e: unknown) {
        return { ok: false, reason: errorMessage(e), session: current };
      }
    } finally {
      this.stopsInFlight.delete(sessionId);
    }
  }

  /**
   * Applies an operator reply to a given session.
   * (Matching replies to sessions automatically comes later, once real reply formats are known.)
   */
  applyReply(sessionId: string, text: string): ServiceResult {
    const session = this.getSession(sessionId);
    if (!session) {
      return { ok: false, reason: `Unknown session "${sessionId}"` };
    }
    const now = this.deps.now();
    const parsed = this.deps.parser.parse(text, now);

    try {
      let next: ParkingSession;
      switch (parsed.kind) {
        case 'confirmed':
          next = transition(session, {
            type: 'OPERATOR_CONFIRMED',
            at: now,
            endTime: parsed.endTime,
          });
          break;
        case 'rejected':
          next =
            session.status === 'stopping'
              ? transition(session, { type: 'STOP_REJECTED' })
              : transition(session, { type: 'OPERATOR_REJECTED', reason: parsed.reason });
          break;
        case 'stop_confirmed':
          next = transition(session, { type: 'STOP_CONFIRMED', at: now });
          break;
        case 'unrecognized':
          return { ok: false, reason: 'Reply not recognized; session unchanged', session };
        default: {
          const unreachable: never = parsed;
          return unreachable;
        }
      }
      this.upsert(next);
      return { ok: true, session: next };
    } catch (e: unknown) {
      return { ok: false, reason: errorMessage(e), session };
    }
  }

  /** Applies expiry and confirmation timeouts. Call this regularly (e.g. every few seconds). */
  refresh(): void {
    const now = this.deps.now();
    this.sessions = this.sessions.map((s) => {
      let current = refreshExpiry(s, now);
      if (
        current.status === 'sms_sent' &&
        current.smsSentAt !== null &&
        now - current.smsSentAt >= CONFIRMATION_TIMEOUT_MS
      ) {
        current = transition(current, { type: 'CONFIRMATION_TIMED_OUT', at: now });
      }
      return current;
    });
  }

  /** Never throws: a sender that throws is treated as "may have sent". */
  private async sendSafely(request: SmsRequest): Promise<SmsSendResult> {
    try {
      return await this.deps.sender.send(request);
    } catch (e: unknown) {
      return {
        ok: false,
        reason: `Sender error: ${errorMessage(e)}`,
        mayHaveSent: true,
      };
    }
  }

  private upsert(session: ParkingSession): void {
    const exists = this.sessions.some((s) => s.id === session.id);
    this.sessions = exists
      ? this.sessions.map((s) => (s.id === session.id ? session : s))
      : [...this.sessions, session];
  }
}