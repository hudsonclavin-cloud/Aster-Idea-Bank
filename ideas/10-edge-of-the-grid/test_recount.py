"""Independent recount of the headline numbers, in Python, straight from Aster's cache.

Run from the bank root: python3 -m unittest discover -s ideas/10-edge-of-the-grid -p 'test_*.py'
Skips itself when the Aster checkout is absent. It shares no code with grid-census.js: dates are
placed on the lattice with datetime arithmetic and the counts are compared with
snapshots/edge-census.json. Standard library only.
"""
import datetime
import json
import os
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
