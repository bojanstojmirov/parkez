import { SessionStatus } from './session';

/** Formats milliseconds as MM:SS, or H:MM:SS from one hour up. Never negative; rounds up. */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** User-facing text per status. Unconfirmed states must never read as paid. */
const STATUS_LABELS: Record<SessionStatus, string> = {
  draft: 'Draft',
  sms_sent: 'SMS sent, waiting for the operator (not confirmed yet)',
  unconfirmed: 'No reply received. Check your messages (not confirmed)',
  operator_confirmed: 'Parking confirmed',
  stopping: 'Stop requested, waiting for confirmation',
  stopped: 'Parking stopped',
  expired: 'Parking expired',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function statusLabel(status: SessionStatus): string {
  return STATUS_LABELS[status];
}