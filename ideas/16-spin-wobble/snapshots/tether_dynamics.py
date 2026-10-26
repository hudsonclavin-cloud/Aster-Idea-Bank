"""
tether_dynamics.py — Lumped-mass planar tether dynamics model.

Seed of the Phase 0 digital twin (project_instructions Part 4.5 deliverable).
Planar (2D, orbital-plane) model of the Rev A rotovator:

  - N lumped nodes (default 17) along the full tether (both arms), center node
    carries the hub mass.
  - Elastic, SLACK-CAPABLE segments: tension = EA*strain when stretched, zero
    when slack (cables cannot push). Optional axial viscous damping.
  - Per-node point-mass gravity a = -mu*r/|r|^3 (NOT the uniform-gradient
    approximation).
  - Fixed-step RK4 integration.
  - Spin superimposed on orbital motion; all defaults from params/rev_a.json
    via physics/skyhook_physics.py at the CURRENT 2.5 km/s reference.

Mass and stiffness discretization [Certain]:
  The continuum uniform-working-stress (taper-optimized) arm profile is
    A(s) = A_L * exp[x^2 * (1 - s^2/L^2)],   A_L = m_p * omega^2 * L / sigma_w
  with sigma_w = sigma*(1-derate)/SF, x = (v_tip/V_c)*sqrt(SF/(1-derate)),
  V_c = sqrt(2*sigma/rho) (EQ-4). This is the same profile whose integrated
  mass gives EQ-6 (Moravec/Forward): m_arm = m_p*sqrt(pi)*x*exp(x^2)*erf(x).
  Node lump masses are EXACT integrals of rho*A(s) over each half-segment
  window (via erf), so total fiber mass matches EQ-6 to machine precision.
  Analytic tension for verification: T(s) = sigma_w * A(s).

Effective modulus [Likely]: E_eff = sigma_w / target_strain, i.e. the tether
carries its design working stress at `target_strain` elongation. Default
target_strain=0.005 gives E_eff ~ 3.2e11 Pa, the right order for PBO fiber
(Zylon HM tensile modulus ~2.7e11 Pa, Toyobo datasheet). target_strain -> 0
recovers the rigid-rotor limit (verification gate V1).

Initial condition [Certain]: rigid rotation at omega = v_tip/L about the CoM
on a circular orbit at the Rev A CoM altitude, tether radial, lower tip
Earthward; segments pre-strained to the discrete free-space rigid-rotation
tension so the start state is near equilibrium (gravity gradient provides the
residual perturbation).

Confidence labels per project convention: [Certain]/[Likely]/[Speculative].
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from physics.skyhook_physics import (  # noqa: E402
    MU_EARTH,
    PARAMS,
    R_EARTH_KM,
    characteristic_velocity_kms,
)

_MAT = PARAMS["materials"]
_DESIGN_PAYLOAD_KG = PARAMS["mass_ratio"][
    "integrated_tether_to_payload_both_arms"]["payload_mass_kg_for_tonnage"]


@dataclass
class TetherConfig:
    """Defaults are the Rev A 2.5 km/s reference (params/rev_a.json)."""
    n_nodes: int = 17
    com_altitude_km: float = PARAMS["orbital"]["com_altitude_km"]      # 610
    half_length_km: float = PARAMS["geometry"]["tether_half_length_km"]  # 320
    v_tip_kms: float = PARAMS["kinematics"]["v_tip_kms"]               # 2.5
    sigma_GPa: float = _MAT["tensile_strength_GPa"]                    # 5.8
    rho_kgm3: float = _MAT["density_kgm3"]                             # 1560
    safety_factor: float = _MAT["safety_factor"]                       # 2.5
    derate: float = _MAT["derate_fraction"]                            # 0.30
    design_payload_kg: float = _DESIGN_PAYLOAD_KG                      # 5000
    # [Speculative] hub mass: project_instructions Part VI Phase 2 quotes a
    # 100-300 t hub; 200 t midpoint used until a hub mass budget exists.
    hub_mass_kg: float = 200e3
    # [Likely] elastic strain at design working stress; see module docstring.
    target_strain: float = 0.005
    gravity: bool = True
    payload_both_tips: bool = False   # attach design payload at both tips (V3)


class TetherSim:
    """Planar lumped-mass tether. State: per-node [x, y, vx, vy] in meters, m/s,
    Earth-centered inertial frame."""

    def __init__(self, cfg: TetherConfig):
        self.cfg = cfg
        n = cfg.n_nodes
        if n < 3 or n % 2 == 0:
            raise ValueError("n_nodes must be odd and >= 3 (center node = hub)")

        L = cfg.half_length_km * 1e3
        self.L = L
        self.omega = cfg.v_tip_kms * 1e3 / L                 # rad/s [Certain]
        self.R_com = (R_EARTH_KM + cfg.com_altitude_km) * 1e3
        self.mu = MU_EARTH

        sigma = cfg.sigma_GPa * 1e9
        self.sigma_w = sigma * (1.0 - cfg.derate) / cfg.safety_factor
        Vc = characteristic_velocity_kms(cfg.sigma_GPa, cfg.rho_kgm3) * 1e3
        self.x_ratio = (cfg.v_tip_kms * 1e3 / Vc) * math.sqrt(
            cfg.safety_factor / (1.0 - cfg.derate))
        self.A_L = cfg.design_payload_kg * self.omega ** 2 * L / self.sigma_w
        self.E_eff = self.sigma_w / cfg.target_strain

        # node arc-positions s_i in [-L, L], spacing h
        self.h = 2.0 * L / (n - 1)
        self.s = [-L + i * self.h for i in range(n)]
        self.center = (n - 1) // 2

        # exact lump masses from the continuum profile [Certain]
        self.m = [self._arm_mass_between(max(abs(si) - self.h / 2, 0.0),
                                         min(abs(si) + self.h / 2, L))
                  for si in self.s]
        # center node straddles s=0: its window [0, h/2] exists on BOTH arms
        self.m[self.center] *= 2.0
        self.m[self.center] += cfg.hub_mass_kg
        if cfg.payload_both_tips:
            self.m[0] += cfg.design_payload_kg
            self.m[-1] += cfg.design_payload_kg

        # segment stiffness EA at segment midpoints [Certain given E_eff]
        self.n_seg = n - 1
        self.seg_mid = [0.5 * (self.s[j] + self.s[j + 1]) for j in range(self.n_seg)]
        self.EA = [self.E_eff * self._area(abs(sm)) for sm in self.seg_mid]

        # pre-strain to the discrete free-space rigid-rotation tension [Certain]
        t_req = self._discrete_static_tensions()
        self.L0 = [self.h / (1.0 + t_req[j] / self.EA[j]) for j in range(self.n_seg)]
        self.k = [self.EA[j] / self.L0[j] for j in range(self.n_seg)]

        # initial state: radial tether, rigid rotation + circular orbit
        v_orb = math.sqrt(self.mu / self.R_com)
        self.state = []
        for i in range(n):
            xi = self.R_com + self.s[i]      # lower tip (s=-L) Earthward
            self.state += [xi, 0.0, 0.0, v_orb + self.omega * self.s[i]]

        self.t = 0.0
        self._damp_c = [0.0] * self.n_seg

    # ── construction helpers ──────────────────────────────────────────────────

    def _area(self, s_abs: float) -> float:
        """Continuum cross-section A(|s|), m^2. [Certain]"""
        L = self.L
        return self.A_L * math.exp(self.x_ratio ** 2 * (1.0 - (s_abs / L) ** 2))

    def _arm_mass_between(self, a: float, b: float) -> float:
        """Exact integral of rho*A(s) ds over [a,b] within one arm, kg. [Certain]"""
        if b <= a:
            return 0.0
        x, L = self.x_ratio, self.L
        coeff = self.cfg.rho_kgm3 * self.A_L * math.exp(x * x) \
            * (L * math.sqrt(math.pi) / (2.0 * x))
        return coeff * (math.erf(x * b / L) - math.erf(x * a / L))

    def _discrete_static_tensions(self) -> list[float]:
        """Free-space rigid-rotation tension per segment (cumulative outboard
        centripetal load), N. [Certain]"""
        t = [0.0] * self.n_seg
        # lower arm: segments 0..center-1, outboard nodes 0..j
        acc = 0.0
        for j in range(self.center):
            acc += self.m[j] * self.omega ** 2 * abs(self.s[j])
            t[j] = acc
        # upper arm: segments center..n_seg-1, outboard nodes j+1..n-1
        acc = 0.0
        for j in range(self.n_seg - 1, self.center - 1, -1):
            acc += self.m[j + 1] * self.omega ** 2 * abs(self.s[j + 1])
            t[j] = acc
        return t

    def analytic_tension(self, s_abs_m: float) -> float:
        """Continuum uniform-stress tension T(s) = sigma_w*A(s), N. [Certain]"""
        return self.sigma_w * self._area(s_abs_m)

    def orbit_period_s(self) -> float:
        return 2.0 * math.pi * math.sqrt(self.R_com ** 3 / self.mu)

    # ── dynamics ──────────────────────────────────────────────────────────────

    def _deriv(self, st: list[float]) -> list[float]:
        n = self.cfg.n_nodes
        mu = self.mu
        grav = self.cfg.gravity
        out = [0.0] * (4 * n)
        ax = [0.0] * n
        ay = [0.0] * n
        # gravity (per-node point mass)
        for i in range(n):
            b = 4 * i
            xi, yi = st[b], st[b + 1]
            out[b] = st[b + 2]
            out[b + 1] = st[b + 3]
            if grav:
                r2 = xi * xi + yi * yi
                gf = -mu / (r2 * math.sqrt(r2))
                ax[i] = gf * xi
                ay[i] = gf * yi
        # segments (slack-capable, optional axial damping)
        for j in range(self.n_seg):
            a4, b4 = 4 * j, 4 * (j + 1)
            dx = st[b4] - st[a4]
            dy = st[b4 + 1] - st[a4 + 1]
            dist = math.sqrt(dx * dx + dy * dy)
            ext = dist - self.L0[j]
            if ext <= 0.0:
                continue          # slack cable: no force, damped or not
            tension = self.k[j] * ext
            if self._damp_c[j] != 0.0:
                dvx = st[b4 + 2] - st[a4 + 2]
                dvy = st[b4 + 3] - st[a4 + 3]
                rate = (dvx * dx + dvy * dy) / dist
                tension += self._damp_c[j] * rate
                if tension < 0.0:
                    tension = 0.0          # a cable cannot push
            fx = tension * dx / dist
            fy = tension * dy / dist
            ax[j] += fx / self.m[j]
            ay[j] += fy / self.m[j]
            ax[j + 1] -= fx / self.m[j + 1]
            ay[j + 1] -= fy / self.m[j + 1]
        for i in range(n):
            out[4 * i + 2] = ax[i]
            out[4 * i + 3] = ay[i]
        return out

    def _rk4_step(self, dt: float) -> None:
        s0 = self.state
        k1 = self._deriv(s0)
        k2 = self._deriv([s0[i] + 0.5 * dt * k1[i] for i in range(len(s0))])
        k3 = self._deriv([s0[i] + 0.5 * dt * k2[i] for i in range(len(s0))])
        k4 = self._deriv([s0[i] + dt * k3[i] for i in range(len(s0))])
        self.state = [s0[i] + dt / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
                      for i in range(len(s0))]
        self.t += dt

    def run(self, duration_s: float, dt: float,
            damping_ratio: float = 0.0) -> None:
        """Advance the simulation. damping_ratio ~ zeta per segment (0 = none)."""
        if damping_ratio:
            m_ref = sum(self.m) / len(self.m)
            self._damp_c = [2.0 * damping_ratio * math.sqrt(self.k[j] * m_ref)
                            for j in range(self.n_seg)]
        else:
            self._damp_c = [0.0] * self.n_seg
        steps = int(round(duration_s / dt))
        for _ in range(steps):
            self._rk4_step(dt)

    def run_measuring(self, duration_s: float, dt: float,
                      node: int = 0) -> dict:
        """
        Advance while accumulating rotation-averaged tip kinematics.

        [Certain] In orbit, gravity-gradient torque exchanges angular momentum
        with the spin periodically (fractional tip-speed modulation of order
        1.5*n^2/omega^2 ~ 3% at Rev A geometry), so INSTANTANEOUS tip speed
        oscillates about the analytic EQ-3 value. The rotation-average is the
        quantity that matches v_tip and v_tip^2/L; averaging over an integer
        number of rotations cancels the periodic exchange.
        """
        steps = int(round(duration_s / dt))
        sum_v = sum_a = 0.0
        for _ in range(steps):
            self._rk4_step(dt)
            rx, ry, vx, vy = self._tip_rel(node)
            v2 = vx * vx + vy * vy
            sum_v += math.sqrt(v2)
            sum_a += v2 / math.hypot(rx, ry)
        return {"mean_tip_speed": sum_v / steps,
                "mean_tip_centripetal_accel": sum_a / steps}

    # ── measurements ──────────────────────────────────────────────────────────

    def com(self) -> tuple[float, float, float, float]:
        M = sum(self.m)
        cx = cy = cvx = cvy = 0.0
        for i, mi in enumerate(self.m):
            b = 4 * i
            cx += mi * self.state[b]
            cy += mi * self.state[b + 1]
            cvx += mi * self.state[b + 2]
            cvy += mi * self.state[b + 3]
        return cx / M, cy / M, cvx / M, cvy / M

    def _tip_rel(self, node: int = 0) -> tuple[float, float, float, float]:
        cx, cy, cvx, cvy = self.com()
        b = 4 * node
        return (self.state[b] - cx, self.state[b + 1] - cy,
                self.state[b + 2] - cvx, self.state[b + 3] - cvy)

    def tip_speed_rel_com(self, node: int = 0) -> float:
        _, _, vx, vy = self._tip_rel(node)
        return math.hypot(vx, vy)

    def tip_centripetal_accel(self, node: int = 0) -> float:
        """|v_rel|^2 / |r_rel| — the EQ-3c centripetal measure, m/s^2."""
        rx, ry, vx, vy = self._tip_rel(node)
        return (vx * vx + vy * vy) / math.hypot(rx, ry)

    def segment_tension(self, j: int) -> float:
        a4, b4 = 4 * j, 4 * (j + 1)
        dx = self.state[b4] - self.state[a4]
        dy = self.state[b4 + 1] - self.state[a4 + 1]
        ext = math.hypot(dx, dy) - self.L0[j]
        return self.k[j] * ext if ext > 0.0 else 0.0

    def tension_nearest(self, s_abs_m: float) -> tuple[float, float]:
        """(segment |midpoint|, tension) for the segment nearest |s| on the
        upper (positive-s) arm."""
        best = min((j for j in range(self.center, self.n_seg)),
                   key=lambda j: abs(self.seg_mid[j] - s_abs_m))
        return abs(self.seg_mid[best]), self.segment_tension(best)

    def total_energy(self) -> float:
        e = 0.0
        for i, mi in enumerate(self.m):
            b = 4 * i
            e += 0.5 * mi * (self.state[b + 2] ** 2 + self.state[b + 3] ** 2)
            if self.cfg.gravity:
                e -= self.mu * mi / math.hypot(self.state[b], self.state[b + 1])
        for j in range(self.n_seg):
            a4, b4 = 4 * j, 4 * (j + 1)
            ext = math.hypot(self.state[b4] - self.state[a4],
                             self.state[b4 + 1] - self.state[a4 + 1]) - self.L0[j]
            if ext > 0.0:
                e += 0.5 * self.k[j] * ext * ext
        return e

    def angular_momentum(self) -> float:
        h = 0.0
        for i, mi in enumerate(self.m):
            b = 4 * i
            h += mi * (self.state[b] * self.state[b + 3]
                       - self.state[b + 1] * self.state[b + 2])
        return h

    # ── catch event (V4) ──────────────────────────────────────────────────────

    def catch_and_measure(self, payload_kg: float, duration_s: float,
                          dt: float) -> dict:
        """
        Clean catch at the lower tip (node 0): payload mass added with velocity
        exactly matching the tip (ideal rendezvous). Tracks the lower-tip
        segment tension; returns peak, static reference, and their ratio.

        Static reference [Likely]: post-catch free-space rigid-rotation tension
        of the tip segment, (m_tip + m_payload)*omega_now^2*L, with omega_now
        measured at the catch instant. Gravity-gradient modulation (~4% at this
        geometry) and CoM shift (~0.6%) are inside the quoted uncertainty.
        """
        omega_now = self.tip_speed_rel_com(0) / self.L
        self.m[0] += payload_kg
        t_static = self.m[0] * omega_now ** 2 * self.L
        peak = 0.0
        steps = int(round(duration_s / dt))
        for _ in range(steps):
            self._rk4_step(dt)
            t0 = self.segment_tension(0)
            if t0 > peak:
                peak = t0
        return {"peak_tension_N": peak,
                "static_tension_N": t_static,
                "peak_over_static": peak / t_static}


if __name__ == "__main__":
    cfg = TetherConfig()
    sim = TetherSim(cfg)
    fiber_total = sum(sim.m) - cfg.hub_mass_kg
    arm_analytic = sim._arm_mass_between(0.0, sim.L)
    print(f"omega = {sim.omega:.6f} rad/s, period = {2*math.pi/sim.omega/60:.2f} min")
    print(f"fiber mass (lumped, both arms) = {fiber_total/1000:.1f} t; "
          f"analytic 2x arm integral = {2*arm_analytic/1000:.1f} t "
          f"(EQ-6 @ 30% derate: 609.1 t)")
    print(f"tip speed rel CoM = {sim.tip_speed_rel_com():.1f} m/s (analytic 2500)")
    print(f"tip centripetal accel = {sim.tip_centripetal_accel():.3f} m/s^2 "
          f"(analytic {2500**2/320000:.3f})")
