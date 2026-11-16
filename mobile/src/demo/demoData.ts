/**
 * DEMO DATA ONLY. These operators, numbers and zones are FAKE and exist only so the
 * prototype screen can run. Never use this for real parking. Remove before release.
 */
import { OperatorProfile, ZoneRule } from '../domain/operators';

const zone = (code: string, maxMinutes: number): ZoneRule => ({
  code,
  maxMinutes,
  pricePerHourDenars: null,
  lastVerified: null,
  source: 'demo',
});

export const DEMO_OPERATORS: readonly OperatorProfile[] = [
  {
    id: 'demo_prepaid',
    displayName: 'Demo operator A (you pick hours)',
    smsNumber: '0000',
    paymentModel: 'prepaid_hours',
    separator: ' ',
    stopKeyword: null,
    zones: [zone('D1', 120), zone('D2', 60)],
  },
  {
    id: 'demo_open',
    displayName: 'Demo operator B (runs until stopped)',
    smsNumber: '0001',
    paymentModel: 'open_until_stop',
    separator: ' ',
    stopKeyword: 'S',
    zones: [zone('D3', 240)],
  },
];