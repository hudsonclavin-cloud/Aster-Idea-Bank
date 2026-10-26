"""unittest for gg_modulation.py: the Python landing sketch, pinned to the same outside numbers as
wobble.test.mjs (golden.json's run, the canon's rotation period, closed-form limits).

Run from the bank root:
    python3 -m unittest discover -s ideas/16-spin-wobble -p 'test_*.py'
"""

import json
import math
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

from gg_modulation import _agm, gravity_gradient_modulation, window_mean_tip_speed  # noqa: E402


def _snap(name):
    return os.path.join(HERE, "snapshots", name)


with open(_snap("rev_a.json")) as fh:
    REV_A = json.load(fh)
with open(_snap("golden.json")) as fh:
    GOLDEN = json.load(fh)
with open(_snap("twin-physics.mjs")) as fh:
    _m = re.search(r"^export const R_EARTH_KM = ([0-9.]+);", fh.read(), re.M)
R_EARTH_KM = float(_m.group(1))

MU = REV_A["orbital"]["mu_earth_m3s2"]
ALT = REV_A["orbital"]["com_altitude_km"]
L_KM = REV_A["geometry"]["tether_half_length_km"]
V_REF = REV_A["kinematics"]["v_tip_kms"]
R_TWIN = R_EARTH_KM + ALT


class ClosedForm(unittest.TestCase):
    def test_agm_gauss_constant(self):
        # Gauss's constant G = 1/AGM(1, sqrt 2) = 0.8346268416740731...
        self.assertAlmostEqual(1 / _agm(1.0, math.sqrt(2.0)), 0.8346268416740731, places=14)

    def test_reference_numbers(self):
        m = gravity_gradient_modulation(V_REF, L_KM, R_TWIN, MU)
        self.assertAlmostEqual(m["v_vertical_mps"], 2500.0, places=9)
        self.assertAlmostEqual(m["dip_fraction"] * 100, 3.410, places=3)
        self.assertAlmostEqual(m["first_order_dip"] * 100, 3.342, places=3)
        self.assertAlmostEqual(m["program_dip"] * 100, 2.879, places=3)
        self.assertAlmostEqual(m["v_mean_mps"], 2457.16, places=2)
        self.assertAlmostEqual(m["half_period_s"], 476.27, places=2)
        self.assertAlmostEqual(m["half_period_no_gradient_s"], 466.80, places=2)

    def test_mean_is_quadrature(self):
        m = gravity_gradient_modulation(V_REF, L_KM, R_TWIN, MU)
        n, w0 = m["n_rad_s"], m["omega_rad_s"]
        r0 = w0 - n
        N = 20000
        T = sum(math.pi / N / math.sqrt(r0 * r0 - 3 * n * n * math.sin((i + 0.5) * math.pi / N) ** 2) for i in range(N))
        self.assertAlmostEqual(m["half_period_s"], T, delta=1e-9 * T)

    def test_canon_rotation_period(self):
        m = gravity_gradient_modulation(V_REF, L_KM, R_TWIN, MU)
        self.assertEqual(round(m["inertial_period_s"] / 60, 1), REV_A["geometry"]["rotation_period_min"])

    def test_horizontal_spinup_elevates(self):
        m = gravity_gradient_modulation(V_REF, L_KM, R_TWIN, MU, spinup_phase_deg=90)
        self.assertAlmostEqual(m["v_horizontal_mps"], 2500.0, places=9)
        self.assertAlmostEqual(m["v_vertical_mps"], 2582.00, places=2)
        self.assertGreater(m["v_mean_mps"], 2500.0)

    def test_refuses(self):
        with self.assertRaises(ValueError):
            gravity_gradient_modulation(0.3, L_KM, R_TWIN, MU)  # slower than n L: not a rotovator
        with self.assertRaises(ValueError):
            gravity_gradient_modulation(0.9, L_KM, R_TWIN, MU)  # librates (needs > n L (1 + sqrt 3))
        with self.assertRaises(ValueError):
            gravity_gradient_modulation(float("nan"), L_KM, R_TWIN, MU)


class Golden(unittest.TestCase):
    def test_golden_window_mean(self):
        dt = GOLDEN["meta"]["dt"]
        steps = round(GOLDEN["meta"]["duration_s"] / dt)
        got = window_mean_tip_speed(V_REF, L_KM, R_TWIN, MU, dt, steps)
        self.assertLess(abs(got - GOLDEN["mean_tip_speed_mps"]) / GOLDEN["mean_tip_speed_mps"], 1e-4)


if __name__ == "__main__":
    unittest.main()
