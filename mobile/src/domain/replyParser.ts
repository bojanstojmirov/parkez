/**
 * Parsing of operator reply SMS messages.
 *
 * The real reply formats are NOT known yet (see PROJECT_STATUS.md). Until real reply
 * texts are collected, the only production parser is UnrecognizedReplyParser, which
 * never confirms anything. A wrong parser could mark an unpaid session as paid.
 */

export type ParsedReply =
  | { kind: 'confirmed'; endTime: number }
  | { kind: 'rejected'; reason: string }
  | { kind: 'stop_confirmed' }
  | { kind: 'unrecognized' };

export interface ReplyParser {
  /** receivedAt: epoch ms when the reply arrived. */
  parse(text: string, receivedAt: number): ParsedReply;
}

/** Safe default: recognizes nothing, so no session can be confirmed by mistake. */
export class UnrecognizedReplyParser implements ReplyParser {
  parse(): ParsedReply {
    return { kind: 'unrecognized' };
  }
}