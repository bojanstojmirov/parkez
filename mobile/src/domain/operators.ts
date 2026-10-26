/**
 * Operator profiles and SMS message building.
 *
 * IMPORTANT: this file defines the SHAPE of operator data only. Real numbers,
 * zones, prices and limits must come from verified data (see PROJECT_STATUS.md),
 * never from guesses.
 */

/** prepaid_hours: user buys N hours. open_until_stop: runs to the zone maximum or until stopped. */
export type PaymentModel = 'prepaid_hours' | 'open_until_stop';

export interface ZoneRule {
  /** Zone code exactly as it must appear in the SMS, e.g. "A3". */
  readonly code: string;
  /** Maximum stay in minutes, or null if unknown / no limit. */
  readonly maxMinutes: number | null;
  /** Price per hour in denars, or null if unknown. */
  readonly pricePerHourDenars: number | null;
  /** ISO date (YYYY-MM-DD) when a human last verified this zone, or null if never. */
  readonly lastVerified: string | null;
  /** Where the data came from (URL or "field test"), or null. */
  readonly source: string | null;
}

export interface OperatorProfile {
  readonly id: string;
  readonly displayName: string;
  readonly smsNumber: string;
  readonly paymentModel: PaymentModel;
  /** Separator between parts of the SMS text (unverified: assumed to be a space). */
  readonly separator: string;
  /** Keyword that stops a session early (e.g. "S"), or null if stopping is not supported. */
  readonly stopKeyword: string | null;
  readonly zones: readonly ZoneRule[];
}

/**
 * Normalizes a licence plate: removes spaces and hyphens, uppercases.
 * ASSUMPTION: plates are 4-10 Latin letters/digits. Verify against real plates.
 */
export function normalizePlate(input: string): string {
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(cleaned)) {
    throw new Error(`Invalid license plate: "${input}"`);
  }
  return cleaned;
}

/** Finds a zone by code, ignoring case and surrounding spaces. */
export function findZone(
  profile: OperatorProfile,
  zoneCode: string,
): ZoneRule | undefined {
  const wanted = zoneCode.trim().toUpperCase();
  return profile.zones.find((z) => z.code.toUpperCase() === wanted);
}

/** Builds the SMS text that starts parking. Throws on any invalid input. */
export function buildStartMessage(
  profile: OperatorProfile,
  zoneCode: string,
  plateInput: string,
  hours?: number,
): string {
  const zone = findZone(profile, zoneCode);
  if (!zone) {
    throw new Error(`Unknown zone "${zoneCode}" for operator ${profile.id}`);
  }
  const plate = normalizePlate(plateInput);

  if (profile.paymentModel === 'open_until_stop') {
    if (hours !== undefined) {
      throw new Error(`Operator ${profile.id} does not accept a duration`);
    }
    return [zone.code, plate].join(profile.separator);
  }

  // prepaid_hours
  if (hours === undefined) {
    throw new Error(`Operator ${profile.id} requires a duration in hours`);
  }
  if (!Number.isInteger(hours) || hours < 1) {
    throw new Error(`Duration must be a whole number of hours, got ${hours}`);
  }
  if (zone.maxMinutes !== null && hours * 60 > zone.maxMinutes) {
    throw new Error(
      `Duration of ${hours}h exceeds the maximum of ${zone.maxMinutes} minutes for zone ${zone.code}`,
    );
  }
  return [zone.code, plate, String(hours)].join(profile.separator);
}

/** Builds the SMS text that stops parking early. Throws if the operator has no stop keyword. */
export function buildStopMessage(profile: OperatorProfile): string {
  if (profile.stopKeyword === null) {
    throw new Error(`Operator ${profile.id} does not support stopping`);
  }
  return profile.stopKeyword;
}