import { useState, useMemo } from "react";

// ───────────────────────── constants & helpers ─────────────────────────
const MU = 3.986004418e14; // m^3/s^2
const R_EARTH = 6371e3; // m
const V_EQ = 465; // m/s, equatorial surface rotation

const MATERIALS = {
  "Zylon (PBO)": { sigma: 5.8e9, rho: 1560 },
  "T1000G carbon": { sigma: 6.4e9, rho: 1800 },
  "Dyneema SK99": { sigma: 3.9e9, rho: 970 },
  "Spectra 2000": { sigma: 3.5e9, rho: 970 },
  "M5 (PIPD)": { sigma: 5.3e9, rho: 1700 },
  "CNT yarn (future)": { sigma: 25e9, rho: 1300 },
};

// conservatism ladder: derate on fiber strength (joints/weave/aging),
// ascent losses, launch $/kg during construction, power-chain efficiency
const LADDER = {
  Conservative: { derate: 0.6, losses: 1800, launch: 2500, eff: 0.15, kwh: 0.08 },
  Baseline: { derate: 0.72, losses: 1500, launch: 1500, eff: 0.2, kwh: 0.06 },
  Optimistic: { derate: 0.85, losses: 1200, launch: 800, eff: 0.3, kwh: 0.04 },
};

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}

const fmt = (v, d = 2) =>
  !isFinite(v) ? "—" : Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(d);

// ───────────────────────── styles (matches the program site) ─────────────────────────
const C = {
  paper: "#EDF1F5", panel: "#FFFFFF", ink: "#13294B", blue: "#2B5FAE",
  orange: "#F25C1B", soft: "#5A6B85", grid: "rgba(43,95,174,.14)",
};
const mono = "'IBM Plex Mono','SFMono-Regular',Consolas,monospace";
const disp = "'Space Grotesk','Segoe UI',system-ui,sans-serif";

function Row({ label, sym, value, unit, warn, good }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "7px 0", borderBottom: `1px dashed ${C.grid}`, gap: 10 }}>
      <span style={{ fontFamily: disp, fontSize: 13.5, color: C.ink }}>
        {label} {sym && <span style={{ fontFamily: mono, fontSize: 12, color: C.blue }}>{sym}</span>}
      </span>
      <span style={{ fontFamily: mono, fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap",
        color: warn ? "#C0392B" : good ? "#1E7F4F" : C.ink }}>
        {value} <span style={{ fontWeight: 400, fontSize: 11.5, color: C.soft }}>{unit}</span>
      </span>
    </div>
  );
}

function Slider({ label, sym, value, set, min, max, step, unit }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: disp, fontSize: 13, marginBottom: 3 }}>
        <span style={{ color: C.ink, fontWeight: 600 }}>
          {label} <span style={{ fontFamily: mono, color: C.blue, fontWeight: 400 }}>{sym}</span>
        </span>
        <span style={{ fontFamily: mono, color: C.orange, fontWeight: 600 }}>
          {value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => set(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: C.orange }} />
    </div>
  );
}

// ───────────────────────── main component ─────────────────────────
export default function SkyhookCalculator() {
  const [alt, setAlt] = useState(610); // km, CoM altitude
  const [L, setL] = useState(320); // km half-length
  const [vtip, setVtip] = useState(2.5); // km/s
  const [mat, setMat] = useState("Zylon (PBO)");
  const [SF, setSF] = useState(2.5);
  const [payload, setPayload] = useState(5000); // kg per catch
  const [mode, setMode] = useState("Conservative");
  const [ve, setVe] = useState(3.4); // km/s vehicle exhaust velocity
  const [cadence, setCadence] = useState(1); // catches per day
  const [price, setPrice] = useState(500); // $/kg sell price

  const r = useMemo(() => {
    const lad = LADDER[mode];
    const m = MATERIALS[mat];
    const R = R_EARTH + alt * 1e3;
    const vorb = Math.sqrt(MU / R); // m/s
    const vt = vtip * 1e3;
    const Lm = L * 1e3;
    const omega = vt / Lm;
    const period = (2 * Math.PI) / omega / 60; // min
    const atip = (vt * vt) / Lm; // m/s^2

    // material: derated characteristic velocity, SF folded into working stress
    const Vc = Math.sqrt((2 * m.sigma * lad.derate) / m.rho); // ideal derated
    const Vw = Vc / Math.sqrt(SF); // working char. velocity at safety factor
    const x = vt / Vw;
    const taper = Math.exp(x * x);
    // Moravec/Forward tapered-tether mass ratio (tether mass per tip mass)
    const massRatio = Math.sqrt(Math.PI) * x * Math.exp(x * x) * erf(x);
    const tetherMass = massRatio * payload; // per arm; double for two arms w/ both tips loaded
    const tetherMassTotal = 2 * tetherMass;

    // lower tip rendezvous
    const vCatchGround = vorb - vt - V_EQ; // m/s, prograde equatorial help
    const dvVehicle = vCatchGround + lad.losses; // + gravity/drag losses
    const dvAllRocket = 9400; // m/s reference
    const dvSaved = dvAllRocket - dvVehicle;
    // payload fraction: rocket eq minus structural fraction
    const struct = 0.10;
    const pfSky = Math.max(0, Math.exp(-dvVehicle / (ve * 1e3)) - struct);
    const pfRocket = Math.max(0, Math.exp(-dvAllRocket / (ve * 1e3)) - struct);
    const gain = pfRocket > 0 ? pfSky / pfRocket : Infinity;

    // release condition at upper tip
    const rRel = R + Lm;
    const vRel = vorb + vt;
    const vEsc = Math.sqrt((2 * MU) / rRel);
    const C3 = (vRel * vRel - vEsc * vEsc) / 1e6; // km^2/s^2
    const escapes = vRel >= vEsc;

    // economics
    const tetherLaunchCost = (tetherMassTotal * 1.6 * lad.launch) / 1e6; // +60% hub/hardware mass factor, $M
    // marginal: energy to restore = ΔE per kg boosted ≈ vorb * Δv_imparted (momentum view) → use specific
    // orbital energy delta of payload from catch state to release state, restored at chain efficiency
    const dE = (vRel * vRel - (vorb - vt) * (vorb - vt)) / 2; // J/kg
    const elec = ((dE / lad.eff) / 3.6e6) * lad.kwh; // $/kg of electricity
    const marginal = elec + 8; // + ops/wear/insurance increment placeholder ($/kg)
    const annualMass = cadence * 365 * payload; // kg/yr
    const annualRev = (annualMass * price) / 1e6; // $M
    const annualMarginalCost = (annualMass * marginal) / 1e6;

    return { vorb, omega, period, atip, Vc, Vw, x, taper, massRatio, tetherMassTotal,
      vCatchGround, dvVehicle, dvSaved, pfSky, pfRocket, gain, vRel, vEsc, C3, escapes,
      tetherLaunchCost, elec, marginal, annualRev, annualMarginalCost, annualMass };
  }, [alt, L, vtip, mat, SF, payload, mode, ve, cadence, price]);

  const tipKm = alt - L;
  const warnTaper = r.taper > 150;
  const warnTip = tipKm < 80;
  const warnG = r.atip > 60;

  // live taper SVG path (symmetric exponential bulge, normalized)
  const taperPath = useMemo(() => {
    const W = 560, H = 110, mid = H / 2, n = 60;
    const xs = [];
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * 2 - 1; // -1..1 position along tether
      const a = Math.exp(r.x * r.x * (1 - u * u)); // area profile
      xs.push(a);
    }
    const maxA = Math.max(...xs);
    let top = "", bot = "";
    xs.forEach((a, i) => {
      const px = 20 + (i / n) * W;
      const h = 4 + (a / maxA) * (H / 2 - 8);
      top += `${i ? "L" : "M"}${px},${mid - h} `;
      bot = `L${px},${mid + h} ` + bot;
    });
    return top + xs.map(() => "").join("") + bot + "Z";
  }, [r.x]);

  const lad = LADDER[mode];

  return (
    <div style={{ background: C.paper, minHeight: "100vh", padding: "0 0 40px", color: C.ink,
      fontFamily: "'Spectral',Georgia,serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Spectral:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        input[type=range]{height:4px}`}</style>

      {/* header */}
      <div style={{ background: C.ink, color: "#E8EEF7", padding: "22px 24px 18px" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto" }}>
          <div style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: ".12em", color: "#9FB6D8" }}>
            SKYHOOK PROGRAM · RULE 1 — SINGLE SOURCE OF TRUTH
          </div>
          <h1 style={{ fontFamily: disp, fontSize: 30, margin: "6px 0 4px", letterSpacing: "-.01em" }}>
            Reference Design Calculator <span style={{ color: "#FFB58A" }}>· Rev A</span>
          </h1>
          <div style={{ fontSize: 14.5, color: "#B9C8DF" }}>
            Every number downstream of your inputs, computed live from EQ 1–5. State your assumptions; the ladder states the rest.
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "20px 18px", display: "grid",
        gridTemplateColumns: "minmax(280px,360px) 1fr", gap: 18 }}>

        {/* ───── INPUTS ───── */}
        <div style={{ background: C.panel, border: `1px solid rgba(19,41,75,.14)`, borderRadius: 10, padding: 18 }}>
          <div style={{ fontFamily: disp, fontWeight: 700, fontSize: 12, letterSpacing: ".15em",
            color: C.blue, marginBottom: 12 }}>— DESIGN INPUTS</div>

          {/* conservatism ladder */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {Object.keys(LADDER).map((k) => (
              <button key={k} onClick={() => setMode(k)}
                style={{ flex: 1, fontFamily: disp, fontSize: 11.5, fontWeight: 700, padding: "7px 4px",
                  borderRadius: 99, cursor: "pointer",
                  border: `1.5px solid ${mode === k ? C.orange : "rgba(19,41,75,.25)"}`,
                  background: mode === k ? C.orange : "transparent",
                  color: mode === k ? "#fff" : C.soft }}>
                {k}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: C.soft, marginBottom: 14 }}>
            fiber derate {Math.round(lad.derate * 100)}% · ascent losses {lad.losses} m/s · launch ${lad.launch}/kg · power chain {Math.round(lad.eff * 100)}%
          </div>

          <Slider label="CoM altitude" sym="h" value={alt} set={setAlt} min={300} max={1200} step={10} unit=" km" />
          <Slider label="Half-length" sym="L" value={L} set={setL} min={10} max={500} step={5} unit=" km" />
          <Slider label="Tip speed" sym="v_tip" value={vtip} set={setVtip} min={0.5} max={5} step={0.1} unit=" km/s" />
          <Slider label="Safety factor" sym="SF" value={SF} set={setSF} min={1.5} max={4} step={0.1} unit="×" />
          <Slider label="Payload per catch" sym="m_p" value={payload} set={setPayload} min={100} max={20000} step={100} unit=" kg" />
          <Slider label="Vehicle exhaust vel." sym="v_e" value={ve} set={setVe} min={2.8} max={4.5} step={0.1} unit=" km/s" />
          <Slider label="Cadence" sym="" value={cadence} set={setCadence} min={0.1} max={6} step={0.1} unit=" catch/day" />
          <Slider label="Boost price" sym="" value={price} set={setPrice} min={100} max={3000} step={50} unit=" $/kg" />

          <div style={{ fontFamily: disp, fontSize: 13, fontWeight: 600, margin: "4px 0 6px" }}>Tether material</div>
          <select value={mat} onChange={(e) => setMat(e.target.value)}
            style={{ width: "100%", fontFamily: mono, fontSize: 13, padding: "8px 10px",
              border: `1.5px solid rgba(19,41,75,.25)`, borderRadius: 8, background: "#F7FAFD", color: C.ink }}>
            {Object.entries(MATERIALS).map(([k, v]) => (
              <option key={k} value={k}>{k} — σ {(v.sigma / 1e9).toFixed(1)} GPa · ρ {v.rho}</option>
            ))}
          </select>
        </div>

        {/* ───── OUTPUTS ───── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* warnings */}
          {(warnTaper || warnTip || warnG || !r.escapes) && (
            <div style={{ background: "#FFF4EC", border: "1px solid #F7C6A8",
              borderLeft: `5px solid ${C.orange}`, borderRadius: "0 8px 8px 0", padding: "10px 14px",
              fontFamily: disp, fontSize: 13 }}>
              {warnTaper && <div>⚠ Taper &gt; 150:1 — tether mass exploding. Rule 2.3: stay below ~1.3 V_c without sign-off.</div>}
              {warnTip && <div>⚠ Lower tip dips to {tipKm} km — below ~80 km means severe aerothermal load every pass.</div>}
              {warnG && <div>⚠ Tip load {fmt(r.atip / 9.81, 1)} g — re-rate payload adapters and grapple.</div>}
              {!r.escapes && <div>ℹ Upper-tip release is below escape — products limited to LEO/GTO-class boosts at this v_tip.</div>}
            </div>
          )}

          {/* kinematics + tether grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: C.panel, border: `1px solid rgba(19,41,75,.14)`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontFamily: disp, fontWeight: 700, fontSize: 12, letterSpacing: ".15em", color: C.blue, marginBottom: 6 }}>— KINEMATICS (EQ 2–3)</div>
              <Row label="Orbital velocity" sym="v_orb" value={fmt(r.vorb / 1000)} unit="km/s" />
              <Row label="Spin rate" sym="ω" value={(r.omega * 1000).toFixed(2)} unit="mrad/s" />
              <Row label="Rotation period" value={fmt(r.period, 1)} unit="min" />
              <Row label="Lower tip altitude" value={tipKm} unit="km" warn={warnTip} />
              <Row label="Catch speed (ground-rel.)" value={fmt(r.vCatchGround / 1000)} unit="km/s" good />
              <Row label="Vehicle Δv incl. losses" sym="Δv" value={fmt(r.dvVehicle / 1000)} unit="km/s" />
              <Row label="Δv saved vs all-rocket" value={fmt(r.dvSaved / 1000)} unit="km/s" good />
              <Row label="Tip g-load" sym="v²/L" value={fmt(r.atip / 9.81, 1)} unit="g" warn={warnG} />
              <Row label="Release velocity" value={fmt(r.vRel / 1000)} unit="km/s" />
              <Row label={r.escapes ? "Escapes — C3" : "Escape margin"} sym="C3"
                value={fmt(r.C3, 1)} unit="km²/s²" good={r.escapes} warn={!r.escapes} />
            </div>

            <div style={{ background: C.panel, border: `1px solid rgba(19,41,75,.14)`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontFamily: disp, fontWeight: 700, fontSize: 12, letterSpacing: ".15em", color: C.blue, marginBottom: 6 }}>— TETHER (EQ 4)</div>
              <Row label="Derated char. velocity" sym="V_c" value={fmt(r.Vc / 1000)} unit="km/s" />
              <Row label="Working ratio" sym="v_tip/(V_c/√SF)" value={fmt(r.x)} unit="" warn={r.x > 1.35} />
              <Row label="Taper ratio" value={fmt(r.taper, 1)} unit=": 1" warn={warnTaper} />
              <Row label="Tether ÷ payload mass" value={fmt(r.massRatio, 0)} unit="×" />
              <Row label="Total tether mass (2 arms)" value={fmt(r.tetherMassTotal / 1000, 0)} unit="t" />
              {/* live taper profile */}
              <svg viewBox="0 0 600 110" style={{ width: "100%", marginTop: 10,
                background: `linear-gradient(${C.grid} 1px,transparent 1px),linear-gradient(90deg,${C.grid} 1px,transparent 1px)`,
                backgroundSize: "16px 16px", borderRadius: 6 }}>
                <path d={taperPath} fill={C.blue} opacity="0.85" stroke={C.ink} strokeWidth="1.5" />
                <circle cx="300" cy="55" r="5" fill={C.orange} stroke="#fff" strokeWidth="1.5" />
                <text x="300" y="14" textAnchor="middle" fontFamily={mono} fontSize="10" fill={C.soft}>
                  equal-stress profile · live
                </text>
              </svg>
              <div style={{ fontFamily: disp, fontSize: 12, color: C.soft, marginTop: 6 }}>
                Payload fraction: <b style={{ color: "#1E7F4F" }}>{(r.pfSky * 100).toFixed(1)}%</b> with skyhook vs{" "}
                <b>{(r.pfRocket * 100).toFixed(1)}%</b> all-rocket → <b style={{ color: C.orange }}>{fmt(r.gain, 1)}× payload per flight</b>
              </div>
            </div>
          </div>

          {/* economics */}
          <div style={{ background: C.ink, color: "#E8EEF7", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontFamily: disp, fontWeight: 700, fontSize: 12, letterSpacing: ".15em", color: "#FFB58A", marginBottom: 8 }}>
              — ECONOMICS (RULE 3: NOT DONE UNTIL COSTED) · {mode.toUpperCase()} LADDER
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, fontFamily: mono }}>
              <div><div style={{ fontSize: 22, fontWeight: 600, color: "#FFD9C2" }}>${fmt(r.tetherLaunchCost, 0)} M</div>
                <div style={{ fontSize: 11, color: "#9FB6D8" }}>tether+hub launch capex (×1.6 hardware factor)</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 600, color: "#FFD9C2" }}>${fmt(r.elec, 1)}/kg</div>
                <div style={{ fontSize: 11, color: "#9FB6D8" }}>reboost electricity per boosted kg</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 600, color: "#FFD9C2" }}>${fmt(r.marginal, 0)}/kg</div>
                <div style={{ fontSize: 11, color: "#9FB6D8" }}>marginal cost incl. ops/wear</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 600, color: "#7FE0AC" }}>${fmt(r.annualRev, 0)} M/yr</div>
                <div style={{ fontSize: 11, color: "#9FB6D8" }}>revenue @ {price} $/kg · {fmt(r.annualMass / 1000, 0)} t/yr</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 600, color: "#7FE0AC" }}>
                {fmt((r.annualRev - r.annualMarginalCost) > 0 ? r.tetherLaunchCost / (r.annualRev - r.annualMarginalCost) : Infinity, 1)} yr</div>
                <div style={{ fontSize: 11, color: "#9FB6D8" }}>naive payback on launch capex (excl. fleet/program)</div></div>
            </div>
            <div style={{ fontFamily: disp, fontSize: 11.5, color: "#9FB6D8", marginTop: 12, borderTop: "1px solid rgba(255,255,255,.15)", paddingTop: 8 }}>
              Models: EQ 1 payload fraction with 10% structure · Moravec/Forward tapered mass ratio √π·x·eˣ²·erf(x) · momentum restored at {Math.round(lad.eff * 100)}% chain efficiency, ${lad.kwh}/kWh. Per Rule 2, treat ops/wear $8/kg and the ×1.6 hardware factor as <b style={{ color: "#FFB58A" }}>labeled assumptions</b> pending subsystem estimates. Base case decisions: Conservative ladder only (Rule 4).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
