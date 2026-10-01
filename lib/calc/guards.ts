// Input checks shared by the calc functions. Money math must fail loudly on an
// impossible input instead of returning a number the agent could show a user.

export function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
}

export function requireNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be zero or more, got ${value}`);
  }
}

/** A rate or share from 0 up to (not including) 1, e.g. a fee rate or a discount. */
export function requireFraction(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`${name} must be at least 0 and below 1, got ${value}`);
  }
}

/** A share of value that can be paid out in full, e.g. a loan-to-value ratio. */
export function requireShareUpToOne(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`${name} must be above 0 and at most 1, got ${value}`);
  }
}

/** A yearly growth rate. It can be negative (prices fall), but not -100% or worse. */
export function requireGrowthRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= -1) {
    throw new RangeError(`${name} must be above -1 (-100%), got ${value}`);
  }
}
