/**
 * DEMO ONLY. Understands the fake replies produced by the screen's "Simulate" buttons.
 * Real operator reply formats are unknown and are NOT implemented here.
 */
import { ParsedReply, ReplyParser } from '../domain/replyParser';

export class DemoReplyParser implements ReplyParser {
  parse(text: string): ParsedReply {
    const [head, ...rest] = text.trim().split(' ');
    if (head === 'OK') {
      const endTime = Number(rest[0]);
      return Number.isFinite(endTime)
        ? { kind: 'confirmed', endTime }
        : { kind: 'unrecognized' };
    }
    if (head === 'NO') return { kind: 'rejected', reason: rest.join(' ') || 'Rejected' };
    if (head === 'STOPPED') return { kind: 'stop_confirmed' };
    return { kind: 'unrecognized' };
  }
}