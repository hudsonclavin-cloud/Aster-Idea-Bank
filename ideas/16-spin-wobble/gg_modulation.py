"""gg_modulation.py - landing sketch for Skyhook's physics/skyhook_physics.py (Python 3, stdlib only).

The same closed form as wobble.js, written the way it would sit beside EQ-1..EQ-6. In Skyhook it
would import MU_EARTH, R_EARTH_KM and PARAMS from physics/skyhook_physics.py (Rule 1); here every
input is an argument, and test_gg_modulation.py supplies them from the snapshots (mu and the
geometry from snapshots/rev_a.json, R_EARTH_KM from snapshots/twin-physics.mjs).

[Certain] A rigid line body (any mass distribution along a straight line) spinning prograde in the
plane of a circular orbit obeys theta'' = -3 n^2 sin(theta) cos(theta), theta measured from the
local vertical in the orbiting frame, n = sqrt(mu/R^3); so theta'^2 + 3 n^2 sin^2(theta) = C. The
tip speed relative to the centre of mass is L (n + theta'). Spun up at angle theta0 with tip speed
v0: theta'(theta0) = v0/L - n. The time-mean of theta' over a modulation period is
AGM(theta'_max, theta'_min) (Gauss's AGM form of the complete elliptic integral K).
[Likely] Against Skyhook's 17-node twin the closed form holds to 8.6 % of the swing (the twin's
chain bends); against its golden run's 600 s mean tip speed, to 4.4e-5.
"""

import math


def _agm(a, b):
    """Arithmetic-geometric mean of two positive numbers."""
    for _ in range(64):
        a1, b1 = 0.5 * (a + b), math.sqrt(a * b)
        if abs(a1 - b1) <= 1e-16 * a1:
            return 0.5 * (a1 + b1)
        a, b = a1, b1
    return 0.5 * (a + b)


def gravity_gradient_modulation(v_tip_kms, L_km, com_radius_km, mu_m3s2, spinup_phase_deg=0.0):
    """Tip-speed modulation of a rigid tether by the orbital gravity gradient.

    v_tip_kms is the tip speed relative to the centre of mass at the spin-up angle (degrees from
    the local vertical; 0 = tether vertical, where the catch and the release happen).
    Returns speeds in m/s, times in s, fractions as fractions. Raises ValueError where the closed
    form does not apply (spin not faster than the orbit; too slow to go over the top).
    """
    L = L_km * 1e3
    R = com_radius_km * 1e3
    v0 = v_tip_kms * 1e3
    if not all(math.isfinite(x) and x > 0 for x in (L, R, v0, mu_m3s2)) or L >= R:
        raise ValueError("inputs must be finite and positive, with L < R")
    n = math.sqrt(mu_m3s2 / R ** 3)
    w0 = v0 / L
    r0 = w0 - n
    if r0 <= 0:
        raise ValueError("spin is not faster than the orbital rate")
    s0 = math.sin(math.radians(spinup_phase_deg))
    C = r0 * r0 + 3 * n * n * s0 * s0
    if C - 3 * n * n <= 0:
        raise ValueError("too slow to go over the top: the tether librates")
    rate_max = math.sqrt(C)
    rate_min = math.sqrt(C - 3 * n * n)
    rate_mean = _agm(rate_max, rate_min)
    nu = n / w0
    return {
        "n_rad_s": n,
        "omega_rad_s": w0,
        "nu": nu,
        "v_vertical_mps": L * (n + rate_max),
        "v_horizontal_mps": L * (n + rate_min),
        "v_mean_mps": L * (n + rate_mean),
        "dip_fraction": 1 - (n + rate_min) / (n + rate_max),
        "first_order_dip": 1.5 * nu * nu / (1 - nu),
        "program_dip": 1.5 * nu * nu,
        "half_period_s": math.pi / rate_mean,
        "half_period_no_gradient_s": math.pi / r0,
        "inertial_period_s": 2 * math.pi / w0,
    }


def window_mean_tip_speed(v_tip_kms, L_km, com_radius_km, mu_m3s2, dt, steps, spinup_phase_deg=0.0):
    """Time-mean tip speed over `steps` RK4 steps of dt from the spin-up state, sampled after each
    step (the way scripts/generate_golden.py forms golden.json's mean_tip_speed_mps)."""
    L = L_km * 1e3
    n = math.sqrt(mu_m3s2 / (com_radius_km * 1e3) ** 3)
    th = math.radians(spinup_phase_deg)
    w = v_tip_kms * 1e3 / L - n

    def f(x):
        return -3 * n * n * math.sin(x) * math.cos(x)

    total = 0.0
    for _ in range(steps):
        k1t, k1w = w, f(th)
        k2t, k2w = w + 0.5 * dt * k1w, f(th + 0.5 * dt * k1t)
        k3t, k3w = w + 0.5 * dt * k2w, f(th + 0.5 * dt * k2t)
        k4t, k4w = w + dt * k3w, f(th + dt * k3t)
        th += dt / 6 * (k1t + 2 * k2t + 2 * k3t + k4t)
        w += dt / 6 * (k1w + 2 * k2w + 2 * k3w + k4w)
        total += L * (n + w)
    return total / steps
