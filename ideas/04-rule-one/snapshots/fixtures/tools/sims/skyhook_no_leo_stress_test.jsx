import React, { useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import revA from "../../params/rev_a.json";

const C = {
  bg: "#0f1115",
  panel: "#171a21",
  panel2: "#1e222b",
  hair: "#2a2f3a",
  ink: "#e8eaed",
  inkSoft: "#9aa0ab",
  inkFaint: "#6b7280",
  teal: "#33b5a6",
  rust: "#d2693f",
  amber: "#d9a441",
  red: "#d9534f",
  green: "#5cb85c",
  violet: "#8c7ae6",
  blue: "#4a90d9",
};

const START_YEAR = 2026;
const HORIZON = 15;

const REVA = {
  comAltitudeKm: revA.orbital.com_altitude_km,
  tetherHalfLengthKm: revA.geometry.tether_half_length_km,
  vOrb: revA.orbital.v_orb_kms,
  vTip: revA.kinematics.v_tip_kms,
  tipG: revA.kinematics.tip_acceleration_g,
  upperRelease: revA.kinematics.v_upper_release_kms,
  launchPriceNow: revA.economics.launch_price_anchor_dedicated_kgs,
  ridesharePrice: revA.economics.launch_price_rideshare_kgs,
  internalMarginal: revA.economics.spacex_internal_marginal_kgs,
  massRatioArmRange: revA.mass_ratio.tether_to_payload_single_arm_range,
};

const SIM_ASSUMPTIONS = {
  globalMarketMaturity: 70e9, // [Likely] Early-2030s launch-services TAM midpoint.
  payloadClass: 5, // [Speculative] Tonnes per catch, Phase 3 reference payload.
  fiberPriceKg: 250, // [Speculative] Delivered Zylon-class fiber price; needs quote.
  facilityCapex: 1800, // [Speculative] $M build and emplacement cost.
  facilityLifeYr: 12, // [Likely] Amortization life.
  catchesPerYr: 220, // [Speculative] Mature throughput driver.
  reboostKwhPerKg: 33, // [Likely] Electric reboost energy per kg thrown.
  elecPriceKwh: 0.12, // [Likely] Electricity price.
  rocketLegCost: 900, // [Speculative] $/kg to fly payload to lower tip only.
  opsAnnual: 70, // [Speculative] $M/yr fixed ops, ground, and G&A.
  insuranceLoad: 180, // [Speculative] $/kg liability and conjunction reserve.
  gtoMult: 2.2, // [Speculative] GTO incumbent price multiple over LEO.
  geoMult: 3.5, // [Speculative] GEO incumbent price multiple over LEO.
  cisMult: 6.0, // [Speculative] Cislunar incumbent price multiple over LEO.
  svcMult: 4.5, // [Speculative] Servicing priced like high-energy work.
  captureShare: 0.30, // [Speculative] Share of addressable market captured.
  customerDiscount: 0.30, // [Speculative] Discount below incumbent price.
  shGTO: 0.40,
  shGEO: 0.30,
  shCis: 0.20,
  shSvc: 0.10,
  leoShareWhenEnabled: 0.60, // [Speculative] LEO mass share if stress-test toggle is on.
  hurdleIRR: 18, // [Speculative] Return-on-build hurdle.
  conjunctionProb: 0.15, // [Speculative] Expected conjunction incidents per year.
  phase2Base: 40, // [Speculative] Baseline capital appetite score.
};

const twoArmMassRatio = REVA.massRatioArmRange[1] * 2;

