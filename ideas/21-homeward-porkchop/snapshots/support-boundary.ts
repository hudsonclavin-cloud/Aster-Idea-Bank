// L1 support boundary (Slice 18 close-out, Item 6 — W4/W5; DEC-18-7).
//
// An L1 body's screening is supported only up to the close approach that
// makes its tier material. Every porkchop cell has an arrival epoch,
// depJD + tofDays (both TDB Julian dates), and the committed tier artifact
// carries the encounter epoch (encounter.jd, CAD's TDB Julian date), so the
// partition needs NO new data: a cell is unsupported when its arrival is at or
// after the encounter. Unsupported cells are de-emphasised, never suppressed —
// "not assessed" and "no opportunity" are different claims.
//
// Pure module: no app/ or view imports.

import type { TierAssignment } from '../boundary/tier-assignments.js';
import { formatDisclosureDate } from './tier-disclosure.js';

export interface SupportBoundary {
  /** Encounter epoch, Julian date (TDB). */
  readonly encounterJd: number;
  /** 'YYYY-MM-DD' for the readouts. */
  readonly encounterDateLabel: string;
  readonly encounterBody: string;
}

export interface ArrivalCell {
  readonly depJD: number;
  readonly tofDays: number;
}

/** The boundary for an L1 body, or undefined for any other tier (or a record without an encounter). */
export function supportBoundaryFor(tier: TierAssignment | null | undefined): SupportBoundary | undefined {
  if (tier === null || tier === undefined || tier.tier !== 'L1' || tier.encounter === undefined) {
    return undefined;
  }
  if (!Number.isFinite(tier.encounter.jd)) {
    return undefined;
  }
  return {
    encounterJd: tier.encounter.jd,
    encounterDateLabel: formatDisclosureDate(tier.encounter.cd) ?? tier.encounter.cd,
    encounterBody: tier.encounter.body,
  };
}

export function arrivalJd(cell: ArrivalCell): number {
  return cell.depJD + cell.tofDays;
}

/** Unsupported ⇔ arrival at or after the encounter. */
export function isArrivalAfterEncounter(cell: ArrivalCell, boundary: SupportBoundary): boolean {
  return arrivalJd(cell) >= boundary.encounterJd;
}

/** TOF (days) at which a departure on `depJD` arrives exactly at the encounter — the boundary curve. */
export function boundaryTofDaysAtDeparture(depJD: number, boundary: SupportBoundary): number {
  return boundary.encounterJd - depJD;
}

/** Verbatim per the close-out dispatch. */
export function unsupportedCellMessage(boundary: SupportBoundary): string {
  return (
    `Arrival is after this object's ${boundary.encounterDateLabel} encounter. ` +
    'This cell is computed from an orbit that encounter invalidates.'
  );
}

export interface SupportPartition {
  readonly supported: number;
  readonly unsupported: number;
}

export function partitionCells(cells: readonly ArrivalCell[], boundary: SupportBoundary): SupportPartition {
  let unsupported = 0;
  for (const cell of cells) {
    if (isArrivalAfterEncounter(cell, boundary)) {
      unsupported += 1;
    }
  }
  return { supported: cells.length - unsupported, unsupported };
}
