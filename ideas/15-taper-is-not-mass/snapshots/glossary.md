# Skyhook Canonical Glossary
**Rule 7 — Keep definitions current. These supersede any informal usage.**

Last updated: 2026-07-02

---

**C3** (km^2/s^2)
Characteristic energy of a hyperbolic departure: C3 = v_inf^2 = v_departure^2 - v_escape^2. C3 > 0 means the object can escape Earth's gravity. At Rev A reference tip speed (2.5 km/s), upper-tip release evaluated at the upper-tip radius gives C3 ~= -8.06 km^2/s^2 and apogee ~=85,200 km, so the near-term reference is GTO/high-elliptical, not cislunar/TLI. The 2.8 km/s cislunar case is a revenue-gated option; escape (C3=0) is reached at ~2.9 km/s, and Mars-class C3 is retained as a Phase 3 growth option at 3.5 km/s. [Certain]

**Catch window**
The brief interval (typically a few seconds to tens of seconds) during which the lower tip of the rotating tether is within rendezvous range of an ascending payload vehicle. Miss the window, and the vehicle must wait for the next rotation. Duration and frequency are set by tether length, tip speed, and the vehicle's trajectory accuracy. The "multi-second precision rendezvous at hypersonic closing geometries" is one of the six hard parts (Rule 6).

**Characteristic velocity (V_c)** (km/s)
V_c = sqrt(2*sigma/rho): the figure of merit for tether materials. A tether with zero taper can sustain a tip speed of V_c at safety factor 1. Above V_c, cross-section must grow exponentially toward the center. For Zylon PBO at Rev A specs: V_c ~= 2.73 km/s. Rev A reference tip speed (2.5 km/s) = 0.92 x V_c; the 2.8 km/s cislunar case is revenue-gated and the 3.5 km/s Mars-escape case is Phase 3. [Certain]

**Dynamic load factor**
Ratio of peak transient tension to static tension in the tether during a catch event. First program estimate: ~1.47 at the lower-tip segment for a clean velocity-matched catch (undamped, 17-node planar model, V4 gate, 2026-07-02). [Speculative — pending damping validation.] Feeds safety-factor discussions; physically bounded below the SDOF sudden-load limit of 2. Phase-dependent: a JS headless measurement of the digital twin (2026-07-05) found ~1.30 for a catch timed at the lower tip's periapsis (bottom-of-swing, closest approach) versus ~1.47 for the Python V4 gate's arbitrary-phase catch — both [Speculative], and the two measurements' baselines have not yet been verified identical, so the ~1.30-vs-1.47 spread should be read as suggestive of phase-dependence, not as a confirmed delta.

**ED reboost / Electrodynamic reboost**
Restoration of the tether's lost orbital momentum by driving a current through a conductive element along the tether, pushing against Earth's magnetic field using solar-generated electricity. Requires no propellant. Flight-demonstrated by TSS-1R (>3,500V, >1A, 1996) and TEPCE (2019). Primary reboost mechanism for Skyhook.

**Gravity-gradient tip-speed modulation**
Coupling between a rotating tether's spin and the orbital gravity gradient that modulates instantaneous tip speed (~±3% at the Rev A spin ratio) and depresses its rotation-averaged value ~1.5-2% below the free-space figure. [Likely — observed in the lumped-mass model, V1/V2 development, 2026-07-02.] Directly relevant to release-timing and injection accuracy; implies nominal spin rate must be set slightly above the target release speed.

**HASTOL** (Hypersonic Airplane Space Tether Orbital Launch)
Boeing / Tethers Unlimited study (~1999–2001, NASA NIAC funding). Demonstrated on paper that a hypersonic vehicle at Mach 10–12 could hand payload to a 600 km tether (Spectra + Zylon outer segment) with facility mass ~10× payload at SF = 3. Closest literature ancestor of our Phase 2 design. Reports are required reading; HASTOL's 10× figure is *their* result at SF = 3 — our 100–200× planning range is a deliberate conservative derate of our own.

**Hoytether**
Multi-line, cross-linked, redundant tether architecture (Robert Hoyt / Tethers Unlimited). Parallel load-bearing lines interconnected by secondary strands; micrometeoroid severance of individual strands redistributes load, preventing cascade failure. All flight tethers in this program use Hoytether-class architecture. Single-line tethers are forbidden beyond lab demonstrations.

**Libration**
Oscillation of a gravity-gradient stabilized tether around its local vertical — the tether analog of a pendulum. Must be actively damped during operations. A libration control system is Subsystem 6 in the founding document.

**Momentum bank / Momentum ledger**
The accounting framework for the skyhook's orbital energy. Every catch-and-throw of an upbound payload is a "withdrawal" (tether orbit drops). Every catch of a downbound payload (returning capsules, lunar exports, deorbiting satellites) is a "deposit" (orbit rises). ED reboost is the interest-rate mechanism. Balanced two-way traffic allows near-indefinite operation with minimal electric energy expenditure.

**Momentum banking**
The business model: charging customers for momentum withdrawals priced far below equivalent rocket propellant cost, while replenishing momentum at even lower cost via ED reboost and by charging *for* down-mass reception.

**MXER** (Momentum-Exchange / Electrodynamic Reboost)
NASA tether architecture concept (early 2000s) that hybridized rotating momentum-exchange with electrodynamic reboost — exactly the architecture this program adopts. NASA physics studies closed; program was not funded to hardware. See also: HASTOL.

**Rotovator**
Hans Moravec's 1977 term for a rotating tether in orbit whose tip momentarily matches the velocity of a surface or suborbital vehicle. Used interchangeably with "rotating momentum-exchange tether" and "skyhook" in this program, though "skyhook" is preferred in external communications (more intuitive).

**Taper ratio**
Cross-sectional area at tether center divided by cross-sectional area at tip. From EQ-5: Taper ~= exp[(v_tip/V_c)^2 * SF]. At Rev A reference (v_tip = 2.5 km/s, V_c = 2.73 km/s, SF = 2.5, no derate): peak area taper ~= 8.2; with 30% strength derate it is ~=20.1. This is not tether mass ratio: the integrated Moravec/Forward two-arm mass ratio at 2.5 km/s is 40.32x at 0% derate, 64.30x at 15%, and 121.83x at 30%. [Certain]

**TLI** (Trans-Lunar Injection)
The burn (or, for Skyhook, the tether release) that places a payload on a trajectory to the Moon. Rev A uses a 2.5 km/s GTO/high-elliptical reference; 2.8 km/s is the cislunar/TLI revenue-gated option pending a named anchor customer, and Mars-class escape moves to the 3.5 km/s Phase 3 growth option. [Certain]

**Tip vehicle**
The hardware at the tether tip responsible for catching an ascending payload: grappling mechanism, shock absorbers, guidance sensors, communications. One of the six subsystems requiring hardware development in Phase 0–1.

**Value-capture rate**
The fraction of total delta-v value Skyhook can charge for. The Rev A reference provides 2.5 km/s of GTO/high-elliptical delta-v substitution; 2.8 km/s cislunar service is revenue-gated pending a named customer, and 3.5 km/s is retained as a Phase 3 Mars-class option. Competitive pricing and customer willingness-to-pay set the actual fee lower. The financial model uses an explicit value-capture assumption that must be anchored to named customers.
