/** DEMO ONLY: wires the real session service to the mock sender and a skippable clock. */
import { MockSmsSender } from '../services/mockSmsSender';
import { SessionService } from '../services/sessionService';
import { DEMO_OPERATORS } from './demoData';
import { DemoReplyParser } from './demoReplyParser';

let offsetMs = 0;
let counter = 0;

const now = (): number => Date.now() + offsetMs;
const sender = new MockSmsSender(now);

const service = new SessionService({
  sender,
  parser: new DemoReplyParser(),
  operators: DEMO_OPERATORS,
  now,
  newId: () => `demo-${Date.now()}-${++counter}`,
});

export const demo = {
  sender,
  service,
  operators: DEMO_OPERATORS,
  now,
  /** Moves the app's clock forward (test only), e.g. to see timeouts and expiry. */
  skipAhead(ms: number): void {
    offsetMs += ms;
  },
};