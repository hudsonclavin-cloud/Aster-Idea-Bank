"""Independent recount of the headline numbers, in Python, straight from Aster's cache.

Run from the bank root: python3 -m unittest discover -s ideas/10-edge-of-the-grid -p 'test_*.py'
Skips itself when the Aster checkout is absent. It shares no code with grid-census.js: dates are
placed on the lattice with datetime arithmetic, basins are found by breadth-first search (the module
uses union-find), and the counts, inward rises, vertex split, interior alternative, arrival-aware
basins and the class and H tables are compared with snapshots/edge-census.json. Standard library only.
"""
import datetime
import json
import math
import os
import statistics
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ASTER = os.environ.get("ASTER_DIR", "/home/user/asteroid-mining-planner")
SNAP = os.path.join(HERE, "snapshots", "edge-census.json")


def load_census():
    with open(SNAP, encoding="utf-8") as fh:
        return json.load(fh)


class Recount(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.census = load_census()
        cache_path = os.path.join(ASTER, cls.census["inputs"]["cache"]["path"])
        if not (os.path.isdir(os.path.join(ASTER, ".git")) and os.path.isfile(cache_path)):
            raise unittest.SkipTest(f"Aster checkout not present at {ASTER}")
        with open(cache_path, encoding="utf-8") as fh:
            cls.cache = json.load(fh)
        m = cls.cache["metadata"]
        cls.start = datetime.date.fromisoformat(m["screeningWindow"]["startUtc"])
        cls.end = datetime.date.fromisoformat(m["screeningWindow"]["endUtc"])
        cls.spacing = m["departureGridSpacingDays"]
        cls.tof_min = m["tofMinDays"]
        cls.tof_spacing = m["tofGridSpacingDays"]
        cls.n_cols = (cls.end - cls.start).days // cls.spacing + 1
        cls.n_rows = (m["tofMaxDays"] - cls.tof_min) // cls.tof_spacing + 1

    def col(self, window):
        days = (datetime.date.fromisoformat(window["launchDate"]) - self.start).days
        self.assertEqual(days % self.spacing, 0, window)
        return days // self.spacing

    def row(self, window):
        off = window["tofDays"] - self.tof_min
        self.assertEqual(off % self.tof_spacing, 0, window)
        return off // self.tof_spacing

    def test_lattice_and_year_counts(self):
        c = self.census
        self.assertEqual(self.n_cols, c["lattice"]["nCols"])
        self.assertEqual(self.n_rows, c["lattice"]["nRows"])
        last = self.start + datetime.timedelta(days=(self.n_cols - 1) * self.spacing)
        self.assertEqual(last.isoformat(), c["lattice"]["lastDepartureUtc"])
        years = {}
        with_windows = 0
        dates = set()
        for body in self.cache["bodies"]:
            w = body["bestWindows"]
            if not w:
                continue
            with_windows += 1
            best = min(w, key=lambda x: x["c3"])
            y = int(best["launchDate"][:4])
            years[y] = years.get(y, 0) + 1
            for x in w:
                dates.add(x["launchDate"])
                self.col(x)
                self.row(x)
        self.assertEqual(with_windows, c["bodies"]["withWindows"])
        self.assertEqual(len(dates), c["verification"]["distinctLaunchDates"])
        self.assertEqual(self.n_cols * self.n_rows * with_windows, self.cache["metadata"]["totalSolves"])
        for row in c["years"]:
            self.assertEqual(years.get(row["year"], 0), row["minima"], row["year"])

    def cells_of(self, body):
        return [(self.col(x), self.row(x)) for x in body["bestWindows"]]

    def edge_flags(self, cell):
        c, r = cell
        return {"first": c == 0, "last": c == self.n_cols - 1, "tofMin": r == 0, "tofMax": r == self.n_rows - 1}

    @staticmethod
    def components(cells, close):
        """Connected components by breadth-first search (the module uses union-find)."""
        label = [-1] * len(cells)
        k = 0
        for i in range(len(cells)):
            if label[i] >= 0:
                continue
            label[i] = k
            queue = [i]
            while queue:
                x = queue.pop()
                for j in range(len(cells)):
                    if label[j] < 0 and close(cells[x], cells[j]):
                        label[j] = k
                        queue.append(j)
            k += 1
        return label, k

    def test_rises_vertices_alternatives_and_arrival_basins(self):
        c = self.census
        m = self.cache["metadata"]
        dep, tof = m["departureGridSpacingDays"], m["tofGridSpacingDays"]
        box = lambda a, b: abs(a[0] - b[0]) <= 2 and abs(a[1] - b[1]) <= 1
        arrival = lambda a, b: abs((b[0] - a[0]) * dep + (b[1] - a[1]) * tof) <= 2 * dep and abs(a[1] - b[1]) <= 1
        steps = {"first": (1, 0), "last": (-1, 0), "tofMin": (0, 1), "tofMax": (0, -1)}
        recorded = {k: [] for k in steps}
        bounds = {k: [] for k in steps}
        vertex = {"beyond": 0, "inside": 0, "none": 0}
        alt_gaps, alt_none = [], 0
        arr_hist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        floor_line = []
        rho = tof / dep
        lo, hi = max(1, math.floor(rho) - 1), math.ceil(rho) + 1
        for body in self.cache["bodies"]:
            w = body["bestWindows"]
            if not w:
                continue
            cells = self.cells_of(body)
            c3 = {cl: w[i]["c3"] for i, cl in enumerate(cells)}
            best = min(range(len(w)), key=lambda i: w[i]["c3"])
            bc = cells[best]
            arr_hist[self.components(cells, arrival)[1]] += 1
            flags = self.edge_flags(bc)
            for k, on in flags.items():
                if not on:
                    continue
                dc, dr = steps[k]
                chain = [w[best]["c3"]]
                cc, rr = bc[0] + dc, bc[1] + dr
                while (cc, rr) in c3:
                    chain.append(c3[(cc, rr)])
                    cc, rr = cc + dc, rr + dr
                if len(chain) >= 2:
                    recorded[k].append(chain[1] - chain[0])
                else:
                    bounds[k].append(max(x["c3"] for x in w) - w[best]["c3"])
                if len(chain) >= 3:
                    a, b_, d = chain[:3]
                    curv = d - 2 * b_ + a
                    if curv <= 0:
                        vertex["none"] += 1
                    else:
                        vertex["beyond" if 0.5 - (b_ - a) / curv < 0 else "inside"] += 1
                if k == "tofMin":
                    line = [w[i]["c3"] for i, cl in enumerate(cells) if cl[1] == 1 and lo <= bc[0] - cl[0] <= hi]
                    if line:
                        floor_line.append(min(line) - w[best]["c3"])
            if any(flags.values()):
                label, _ = self.components(cells, box)
                cands = [w[i]["c3"] for i, cl in enumerate(cells) if label[i] != label[best] and not any(self.edge_flags(cl).values())]
                if cands:
                    alt_gaps.append(min(cands) - w[best]["c3"])
                else:
                    alt_none += 1
        E = c["edges"]["byEdge"]
        for k in steps:
            for mine, theirs in ((recorded[k], E[k]["riseRecorded"]), (bounds[k], E[k]["riseBound"])):
                if not mine:
                    self.assertIsNone(theirs, k)
                    continue
                self.assertEqual(len(mine), theirs["n"], k)
                self.assertAlmostEqual(statistics.median(mine), theirs["median"], places=12, msg=k)
                self.assertAlmostEqual(min(mine), theirs["min"], places=12, msg=k)
        self.assertEqual(vertex, c["edges"]["vertex"])
        alt = c["interiorAlternative"]["byRule"][0]
        self.assertEqual(alt["rule"], {"maxColGap": 2, "maxRowGap": 1})
        self.assertEqual(len(alt_gaps), alt["withAlternative"])
        self.assertEqual(alt_none, alt["without"])
        self.assertAlmostEqual(statistics.median(alt_gaps), alt["gapC3"]["median"], places=12)
        arr = next(b for b in c["basins"] if b["rule"].get("arrival"))
        self.assertEqual({str(k): v for k, v in arr_hist.items()}, arr["histogram"])
        fl = E["tofMin"]["arrivalLine"]
        self.assertEqual([lo, hi], fl["offsets"])
        self.assertEqual(len(floor_line), fl["withWindow"])
        self.assertAlmostEqual(statistics.median(floor_line), fl["rise"]["median"], places=12)

    def test_class_and_h_tables(self):
        c = self.census
        with open(os.path.join(ASTER, c["inputs"]["catalog"]["path"]), encoding="utf-8") as fh:
            asteroids = json.load(fh)["asteroids"]

        def h_band(h):
            if h is None or not isinstance(h, (int, float)) or math.isnan(h):
                return "H missing"
            for edge, name in ((18, "H < 18"), (22, "18 ≤ H < 22"), (25, "22 ≤ H < 25"), (28, "25 ≤ H < 28")):
                if h < edge:
                    return name
            return "H ≥ 28"

        tables = {"byClass": {}, "byH": {}}
        for body in self.cache["bodies"]:
            w = body["bestWindows"]
            if not w:
                continue
            cells = self.cells_of(body)
            best = min(range(len(w)), key=lambda i: w[i]["c3"])
            flags = self.edge_flags(cells[best])
            a = asteroids[body["bodyId"]]
            for table, key in (("byClass", a.get("orbitClass") or a.get("class")), ("byH", h_band(a.get("H")))):
                row = tables[table].setdefault(key, {"n": 0, "any": 0, "first": 0, "last": 0, "tofMin": 0, "tofMax": 0})
                row["n"] += 1
                row["any"] += any(flags.values())
                for k, on in flags.items():
                    row[k] += on
        for table in tables:
            theirs = {r["key"]: {k: r[k] for k in ("n", "any", "first", "last", "tofMin", "tofMax")} for r in c["tables"][table]}
            mine = {k: v for k, v in tables[table].items()}
            for key in theirs:
                mine.setdefault(key, {"n": 0, "any": 0, "first": 0, "last": 0, "tofMin": 0, "tofMax": 0})
            self.assertEqual(mine, theirs, table)

    def test_edges_tail_and_basins(self):
        c = self.census
        touched = {"first": 0, "last": 0, "tofMin": 0, "tofMax": 0}
        neighbour = {"first": 0, "last": 0, "tofMin": 0, "tofMax": 0}
        any_edge = 0
        multiple = 0
        tail_after = 0
        any_after = 0
        view_end = c["viewTail"]["depEndUtc"]
        basins = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for body in self.cache["bodies"]:
            w = body["bestWindows"]
            if not w:
                continue
            cells = [(self.col(x), self.row(x)) for x in w]
            best_i = min(range(len(w)), key=lambda i: w[i]["c3"])
            bc, br = cells[best_i]
            flags = {
                "first": bc == 0,
                "last": bc == self.n_cols - 1,
                "tofMin": br == 0,
                "tofMax": br == self.n_rows - 1,
            }
            steps = {"first": (1, 0), "last": (-1, 0), "tofMin": (0, 1), "tofMax": (0, -1)}
            for k, v in flags.items():
                if v:
                    touched[k] += 1
                    dc, dr = steps[k]
                    if (bc + dc, br + dr) in cells:
                        neighbour[k] += 1
            n_flags = sum(flags.values())
            if n_flags:
                any_edge += 1
            if n_flags > 1:
                multiple += 1
            if w[best_i]["launchDate"] > view_end:
                tail_after += 1
            if any(x["launchDate"] > view_end for x in w):
                any_after += 1
            # union-find over |dcol| <= 2 and |drow| <= 1
            parent = list(range(len(cells)))

            def find(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]
                    i = parent[i]
                return i

            for i in range(len(cells)):
                for j in range(i + 1, len(cells)):
                    if abs(cells[i][0] - cells[j][0]) <= 2 and abs(cells[i][1] - cells[j][1]) <= 1:
                        parent[find(i)] = find(j)
            basins[len({find(i) for i in range(len(cells))})] += 1
        for k in touched:
            self.assertEqual(touched[k], c["edges"]["byEdge"][k]["touched"], k)
            self.assertEqual(neighbour[k], c["edges"]["byEdge"][k]["neighbourPresent"], k)
        self.assertEqual(any_edge, c["edges"]["any"])
        self.assertEqual(multiple, c["edges"]["multiple"])
        self.assertEqual(tail_after, c["viewTail"]["minimaAfter"])
        self.assertEqual(any_after, c["viewTail"]["anyWindowAfter"])
        self.assertEqual({str(k): v for k, v in basins.items()}, c["basins"][0]["histogram"])


if __name__ == "__main__":
    unittest.main()
