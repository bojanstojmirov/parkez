import {
  OperatorProfile,
  buildStartMessage,
  buildStopMessage,
  findZone,
  normalizePlate,
} from './operators';

const zone = (code: string, maxMinutes: number | null) => ({
  code,
  maxMinutes,
  pricePerHourDenars: null,
  lastVerified: null,
  source: null,
});

// TEST FIXTURES ONLY: not real operator data.
const PREPAID: OperatorProfile = {
  id: 'test_prepaid',
  displayName: 'Test prepaid',
  smsNumber: '0000',
  paymentModel: 'prepaid_hours',
  separator: ' ',
  stopKeyword: null,
  zones: [zone('T1', 120), zone('T2', 60), zone('T9', null)],
};

const OPEN: OperatorProfile = {
  id: 'test_open',
  displayName: 'Test open',
  smsNumber: '0000',
  paymentModel: 'open_until_stop',
  separator: ' ',
  stopKeyword: 'S',
  zones: [zone('T3', 240)],
};

describe('normalizePlate', () => {
  it('removes spaces and hyphens and uppercases', () => {
    expect(normalizePlate(' sk-123 ab ')).toBe('SK123AB');
  });

  it('rejects invalid plates', () => {
    expect(() => normalizePlate('')).toThrow(/Invalid license plate/);
    expect(() => normalizePlate('AB')).toThrow(/Invalid license plate/);
    expect(() => normalizePlate('SK 12*3')).toThrow(/Invalid license plate/);
  });
});

describe('findZone', () => {
  it('ignores case and surrounding spaces', () => {
    expect(findZone(PREPAID, ' t1 ')?.code).toBe('T1');
  });

  it('returns undefined for unknown zones', () => {
    expect(findZone(PREPAID, 'ZZ')).toBeUndefined();
  });
});

describe('buildStartMessage (prepaid_hours)', () => {
  it('builds zone, plate and hours', () => {
    expect(buildStartMessage(PREPAID, 't1', 'sk 123 ab', 2)).toBe('T1 SK123AB 2');
  });

  it('requires hours', () => {
    expect(() => buildStartMessage(PREPAID, 'T1', 'SK123AB')).toThrow(/requires a duration/);
  });

  it('rejects zero, negative and fractional hours', () => {
    expect(() => buildStartMessage(PREPAID, 'T1', 'SK123AB', 0)).toThrow(/whole number/);
    expect(() => buildStartMessage(PREPAID, 'T1', 'SK123AB', -1)).toThrow(/whole number/);
    expect(() => buildStartMessage(PREPAID, 'T1', 'SK123AB', 1.5)).toThrow(/whole number/);
  });

  it('rejects hours above the zone maximum', () => {
    expect(() => buildStartMessage(PREPAID, 'T2', 'SK123AB', 2)).toThrow(/exceeds the maximum/);
  });

  it('accepts exactly the maximum', () => {
    expect(buildStartMessage(PREPAID, 'T1', 'SK123AB', 2)).toBe('T1 SK123AB 2');
  });

  it('does not check the maximum when it is unknown', () => {
    expect(buildStartMessage(PREPAID, 'T9', 'SK123AB', 10)).toBe('T9 SK123AB 10');
  });

  it('rejects unknown zones', () => {
    expect(() => buildStartMessage(PREPAID, 'ZZ', 'SK123AB', 1)).toThrow(/Unknown zone/);
  });
});

describe('buildStartMessage (open_until_stop)', () => {
  it('builds zone and plate only', () => {
    expect(buildStartMessage(OPEN, 'T3', 'sk123ab')).toBe('T3 SK123AB');
  });

  it('rejects a duration', () => {
    expect(() => buildStartMessage(OPEN, 'T3', 'SK123AB', 2)).toThrow(/does not accept a duration/);
  });
});

describe('buildStopMessage', () => {
  it('returns the stop keyword', () => {
    expect(buildStopMessage(OPEN)).toBe('S');
  });

  it('throws when stopping is not supported', () => {
    expect(() => buildStopMessage(PREPAID)).toThrow(/does not support stopping/);
  });
});