/**
 * Parking session state machine.
 *
 * Core rules:
 *  1. "sms_sent" is NOT paid. Only operator_confirmed / stopping are active.
 *  2. States cannot be skipped; terminal states cannot be left.
 *  3. Time is judged from the operator-confirmed end time, never from an app timer.
 *  4. A second start for the same operator + zone + plate is blocked while one is pending or active.
 *
 * All times are epoch milliseconds. "now" is always passed in, never read from the clock,
 * so everything here is deterministic and testable.
 */
import { normalizePlate } from './operators';

export type SessionStatus =
  | 'draft'
  | 'sms_sent'
  | 'unconfirmed'
  | 'operator_confirmed'
  | 'stopping'
  | 'stopped'
  | 'expired'
  | 'failed'
  | 'cancelled';

/**
 * ASSUMPTION: 3 minutes without an operator reply moves a session to "unconfirmed".
 * To be tuned after real-world tests.
 */
export const CONFIRMATION_TIMEOUT_MS = 3 * 60 * 1000;

export interface ParkingSession {
  readonly id: string;
  readonly operatorId: string;
  readonly zoneCode: string;
  readonly plate: string;
  readonly requestedHours: number | null;
  readonly status: SessionStatus;
  readonly createdAt: number;
  readonly smsSentAt: number | null;
  readonly confirmedAt: number | null;
  readonly confirmedEndTime: number | null;
  readonly stopRequestedAt: number | null;
  readonly endedAt: number | null;
  readonly failureReason: string | null;
}

export type SessionEvent =
  | { type: 'SMS_SENT'; at: number }
  | { type: 'SEND_FAILED'; reason: string }
  | { type: 'CANCEL' }
  | { type: 'CONFIRMATION_TIMED_OUT'; at: number }
  | { type: 'OPERATOR_CONFIRMED'; at: number; endTime: number }
  | { type: 'OPERATOR_REJECTED'; reason: string }
  | { type: 'STOP_SENT'; at: number }
  | { type: 'STOP_CONFIRMED'; at: number }
  | { type: 'STOP_REJECTED' };

const ALLOWED_FROM: Record<SessionEvent['type'], readonly SessionStatus[]> = {
  SMS_SENT: ['draft'],
  SEND_FAILED: ['draft'],
  // Cancel only before sending: once an SMS is sent, money may already be charged.
  CANCEL: ['draft'],
  CONFIRMATION_TIMED_OUT: ['sms_sent'],
  // A late reply still counts, so unconfirmed can still be confirmed.
  OPERATOR_CONFIRMED: ['sms_sent', 'unconfirmed'],
  OPERATOR_REJECTED: ['sms_sent', 'unconfirmed'],
  STOP_SENT: ['operator_confirmed'],
  STOP_CONFIRMED: ['stopping'],
  STOP_REJECTED: ['stopping'],
};

export function createDraftSession(params: {
  id: string;
  operatorId: string;
  zoneCode: string;
  plate: string;
  requestedHours: number | null;
  now: number;
}): ParkingSession {
  return {
    id: params.id,
    operatorId: params.operatorId,
    zoneCode: params.zoneCode.trim().toUpperCase(),
    plate: normalizePlate(params.plate),
    requestedHours: params.requestedHours,
    status: 'draft',
    createdAt: params.now,
    smsSentAt: null,
    confirmedAt: null,
    confirmedEndTime: null,
    stopRequestedAt: null,
    endedAt: null,
    failureReason: null,
  };
}

/** Applies an event. Returns a NEW session; throws on any illegal transition. */
export function transition(
  session: ParkingSession,
  event: SessionEvent,
): ParkingSession {
  if (!ALLOWED_FROM[event.type].includes(session.status)) {
    throw new Error(
      `Invalid transition: ${event.type} is not allowed in status ${session.status}`,
    );
  }

  switch (event.type) {
    case 'SMS_SENT':
      return { ...session, status: 'sms_sent', smsSentAt: event.at };

    case 'SEND_FAILED':
      return { ...session, status: 'failed', failureReason: event.reason };

    case 'CANCEL':
      return { ...session, status: 'cancelled' };

    case 'CONFIRMATION_TIMED_OUT': {
      const sentAt = session.smsSentAt;
      if (sentAt === null || event.at - sentAt < CONFIRMATION_TIMEOUT_MS) {
        throw new Error('Confirmation timeout has not elapsed yet');
      }
      return { ...session, status: 'unconfirmed' };
    }

    case 'OPERATOR_CONFIRMED':
      if (event.endTime <= event.at) {
        throw new Error('Confirmed end time must be in the future');
      }
      return {
        ...session,
        status: 'operator_confirmed',
        confirmedAt: event.at,
        confirmedEndTime: event.endTime,
      };

    case 'OPERATOR_REJECTED':
      return { ...session, status: 'failed', failureReason: event.reason };

    case 'STOP_SENT': {
      const end = session.confirmedEndTime;
      if (end === null || event.at >= end) {
        throw new Error('Cannot stop: the session has already ended');
      }
      return { ...session, status: 'stopping', stopRequestedAt: event.at };
    }

    case 'STOP_CONFIRMED':
      return { ...session, status: 'stopped', endedAt: event.at };

    case 'STOP_REJECTED':
      return { ...session, status: 'operator_confirmed', stopRequestedAt: null };

    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** True only for a paid session whose confirmed end time has not passed. */
export function isActive(session: ParkingSession, now: number): boolean {
  return (
    (session.status === 'operator_confirmed' || session.status === 'stopping') &&
    session.confirmedEndTime !== null &&
    now < session.confirmedEndTime
  );
}

/** Milliseconds left, calculated from the confirmed end time. Null if not active. */
export function remainingMs(session: ParkingSession, now: number): number | null {
  if (!isActive(session, now) || session.confirmedEndTime === null) {
    return null;
  }
  return session.confirmedEndTime - now;
}

/** Marks an active session as expired once its confirmed end time has passed. */
export function refreshExpiry(session: ParkingSession, now: number): ParkingSession {
  const running =
    session.status === 'operator_confirmed' || session.status === 'stopping';
  if (running && session.confirmedEndTime !== null && now >= session.confirmedEndTime) {
    return { ...session, status: 'expired', endedAt: session.confirmedEndTime };
  }
  return session;
}

const BLOCKING_STATUSES: readonly SessionStatus[] = [
  'sms_sent',
  'unconfirmed',
  'operator_confirmed',
  'stopping',
];

export type StartCheck =
  | { allowed: true }
  | { allowed: false; reason: string; blockingSessionId: string };

/** Duplicate-payment guard: blocks a new start while a matching session is pending or active. */
export function canStartSession(
  existing: readonly ParkingSession[],
  candidate: { operatorId: string; zoneCode: string; plate: string },
  now: number,
): StartCheck {
  const plate = normalizePlate(candidate.plate);
  const zone = candidate.zoneCode.trim().toUpperCase();

  for (const raw of existing) {
    const s = refreshExpiry(raw, now);
    if (
      BLOCKING_STATUSES.includes(s.status) &&
      s.operatorId === candidate.operatorId &&
      s.zoneCode === zone &&
      s.plate === plate
    ) {
      return {
        allowed: false,
        reason: `A session for ${plate} in zone ${zone} is already ${s.status}`,
        blockingSessionId: s.id,
      };
    }
  }
  return { allowed: true };
}