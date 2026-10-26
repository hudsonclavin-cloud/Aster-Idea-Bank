#!/usr/bin/env python3
"""
ladder_export.py — read the Skyhook financial workbook's input ladder with the Python standard
library only (zipfile + xml.etree), write it as provenance-carrying JSON, and report what the
committed .xlsx does and does not store.

    python3 ladder_export.py [WORKBOOK.xlsx] [--rows-map ladder_rows.json] [--out ladder.json]
                             [--js page-data.js] [--provenance sidecar.json] [--format text|json]

An .xlsx file is a zip of XML parts. The tool reads xl/workbook.xml (sheet names), the workbook
relationships (which part is which sheet), xl/styles.xml (fonts and fills, so a cell's colour can
be read), xl/sharedStrings.xml when present, docProps (which program wrote the file) and every
worksheet part. For every cell it records the reference, the type, the formula if any, the cached
value if any, and the font/fill colour of its style.

The ladder is the block the workbook's own README sheet calls "blue = change me": fourteen rows x
three scenario columns on the Assumptions sheet. Rows are named by the row map that
finance/skyhook_finance.py uses (_LADDER_ROWS, SCENARIOS, the column letters), read out of that
module by build_data.py and snapshotted as ladder_rows.json. Before trusting a row number the tool
checks that the label in column A says what the key means (LABEL_GUARD below); a sheet whose rows
have moved is refused with the row, the label found and the label expected, exit 1.

Confidence labels follow the Skyhook convention. [Certain] marks what is read directly from the
file's bytes; the drift guard's fragments and the slugging of design-point labels are this tool's
own choices, marked where they appear. The tool computes no economics and never writes the
workbook.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

__version__ = "0.1.0"

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_WORKBOOK = os.path.join(HERE, "snapshots", "skyhook_financial_model.xlsx")
DEFAULT_ROWS_MAP = os.path.join(HERE, "snapshots", "ladder_rows.json")

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

# The workbook README sheet (cell A4) states the colour legend: "BLUE = hardcoded inputs · BLACK =
# formulas · GREEN = cross-sheet links · YELLOW fill = key assumption needing attention". The tool
# reads font and fill colours as ARGB from styles.xml and compares the RGB part. [Certain as a read
# of the legend; the legend is the workbook author's convention]
BLUE_RGB = "0000FF"
GREEN_RGB = "008000"
YELLOW_RGB = "FFFF00"

# Drift guard [this tool's choice]: a fragment that must appear, case-insensitively, in the
# column-A label of the row the row map assigns to each ladder key. Written by reading the
# Assumptions sheet at Skyhook 34935cb; if the sheet is re-laid-out the extractor refuses rather
# than returning the wrong row's numbers under the right name.
LABEL_GUARD = {
    "strength_retention": "strength retention",
    "ascent_losses_ms": "ascent losses",
    "construction_launch_per_kg": "launch price during construction",
    "power_chain_efficiency": "power chain efficiency",
    "electricity_per_kwh": "electricity cost",
    "ops_wear_per_kg": "ops + wear",
    "hardware_mass_factor": "hardware mass factor",
    "customer_price_per_kg": "price to customer",
    "catches_per_day": "catches/day",
    "payload_kg": "payload per catch",
    "revenue_ramp_y1": "revenue ramp",
    "fixed_ops_M": "fixed annual ops cost",
    "tip_speed_kms": "tip speed",
    "program_fleet_capex_M": "fleet capex",
}

# Section headers in column A that bracket the shared design point and the physical constants
# [this tool's choice, read from the sheet]: the first word of each header is matched.
DESIGN_POINT_HEADER = "SHARED DESIGN POINT"
CONSTANTS_HEADER = "PHYSICAL CONSTANTS"
LADDER_HEADER = "LADDER ASSUMPTIONS"
HEADER_ROW_FIRST_CELL = "Parameter"


class WorkbookError(Exception):
    """The file cannot be read as a spreadsheetml package at all (not a zip, no workbook part,
    a missing sheet part, malformed cell). Exit 2: there is nothing to refuse, only nothing to read."""


class LadderError(Exception):
    """A structured refusal: the workbook opened, but does not hold what the row map says, so no
    ladder is returned. str(err) names what was found, what was expected and what would help.
    Exit 1."""


# ── small helpers ────────────────────────────────────────────────────────────

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _findall(el, name):
    return [c for c in el.iter() if _local(c.tag) == name]


def _child(el, name):
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _text(el) -> str:
    """All descendant text, for <is><t>..</t></is> and <si> runs."""
    return "".join(t for t in el.itertext()) if el is not None else ""


_REF = re.compile(r"^([A-Z]+)(\d+)$")


def split_ref(ref: str) -> tuple[str, int]:
    m = _REF.match(ref)
    if not m:
        raise ValueError(f"not a cell reference: {ref!r}")
    return m.group(1), int(m.group(2))


def col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def slug(label: str) -> str:
    """Key for a design-point row [this tool's choice]: the label up to the first ' — ' or ';',
    lower-cased, non-alphanumerics collapsed to '_'."""
    head = re.split(r" — |;", label, maxsplit=1)[0]
    s = re.sub(r"[^a-z0-9]+", "_", head.lower()).strip("_")
    return s


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def md5_hex(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


# ── parsing the parts ────────────────────────────────────────────────────────

def parse_workbook_xml(data: bytes) -> dict:
    root = ET.fromstring(data)
    sheets = []
    for s in _findall(root, "sheet"):
        sheets.append({
            "name": s.get("name"),
            "sheetId": s.get("sheetId"),
            "rId": s.get(f"{{{NS_REL}}}id"),
            "state": s.get("state", "visible"),
        })
    calc = _findall(root, "calcPr")
    return {"sheets": sheets, "calcPr": dict(calc[0].attrib) if calc else None}


def parse_rels(data: bytes) -> dict[str, str]:
    root = ET.fromstring(data)
    out = {}
    for r in _findall(root, "Relationship"):
        target = r.get("Target") or ""
        # Targets are either absolute within the package ("/xl/worksheets/sheet1.xml") or
        # relative to xl/ ("worksheets/sheet1.xml").
        if target.startswith("/"):
            target = target[1:]
        elif not target.startswith("xl/"):
            target = "xl/" + target
        out[r.get("Id")] = target
    return out


def parse_shared_strings(data: bytes) -> list[str]:
    root = ET.fromstring(data)
    return [_text(si) for si in _findall(root, "si")]


def parse_styles(data: bytes) -> dict:
    """Fonts (ARGB or theme), fills (foreground ARGB) and the cellXfs that cells' s= indexes."""
    root = ET.fromstring(data)
    fonts = []
    fonts_el = _child(root, "fonts")
    for f in (fonts_el if fonts_el is not None else []):
        color = _child(f, "color")
        fonts.append({
            "rgb": (color.get("rgb") if color is not None else None),
            "theme": (color.get("theme") if color is not None else None),
            "bold": _child(f, "b") is not None,
            "italic": _child(f, "i") is not None,
        })
    fills = []
    fills_el = _child(root, "fills")
    for fl in (fills_el if fills_el is not None else []):
        pf = _child(fl, "patternFill")
        fg = _child(pf, "fgColor") if pf is not None else None
        fills.append({
            "pattern": pf.get("patternType") if pf is not None else None,
            "rgb": fg.get("rgb") if fg is not None else None,
        })
    xfs = []
    xfs_el = _child(root, "cellXfs")
    for xf in (xfs_el if xfs_el is not None else []):
        xfs.append({"fontId": int(xf.get("fontId", 0)), "fillId": int(xf.get("fillId", 0))})
    return {"fonts": fonts, "fills": fills, "xfs": xfs}


def style_colours(styles: dict, s: int | None) -> tuple[str | None, str | None]:
    """(font RGB, fill RGB) for a cell style index, RGB without the alpha byte, or None."""
    if s is None or not styles or s >= len(styles["xfs"]):
        return None, None
    xf = styles["xfs"][s]
    font = styles["fonts"][xf["fontId"]] if xf["fontId"] < len(styles["fonts"]) else {}
    fill = styles["fills"][xf["fillId"]] if xf["fillId"] < len(styles["fills"]) else {}
    frgb = font.get("rgb")
    firgb = fill.get("rgb") if fill.get("pattern") == "solid" else None
    return (frgb[-6:].upper() if frgb else None), (firgb[-6:].upper() if firgb else None)


def parse_sheet(data: bytes, shared_strings: list[str] | None, styles: dict | None) -> list[dict]:
    """Every <c> on a worksheet part as a dict:
       ref, col, row, t (the type attribute), s (style index), formula (str or None),
       cached (text of a non-empty <v> under a formula, else None), kind, value, raw,
       font_rgb, fill_rgb.
    kind is one of formula / number / string / bool / error / empty. [Certain as a read of the XML]
    """
    root = ET.fromstring(data)
    cells = []
    sheet_data = _child(root, "sheetData")
    if sheet_data is None:
        return cells
    for row_el in sheet_data:
        if _local(row_el.tag) != "row":
            continue
        for c in row_el:
            if _local(c.tag) != "c":
                continue
            ref = c.get("r")
            if not ref:
                continue
            col, row = split_ref(ref)
            t = c.get("t", "n")
            s = int(c.get("s")) if c.get("s") is not None else None
            f_el = _child(c, "f")
            v_el = _child(c, "v")
            is_el = _child(c, "is")
            v_text = (v_el.text or "").strip() if v_el is not None else None
            if v_text == "":
                v_text = None
            cell = {"ref": ref, "col": col, "row": row, "t": t, "s": s, "formula": None,
                    "cached": None, "kind": "empty", "value": None, "raw": None}
            if f_el is not None:
                cell["formula"] = (f_el.text or "")
                cell["kind"] = "formula"
                cell["cached"] = v_text
                cell["raw"] = v_text
            elif t == "s":
                idx = int(v_text) if v_text is not None else None
                if shared_strings is None or idx is None or idx >= len(shared_strings):
                    raise WorkbookError(f"{ref} is a shared string (t=\"s\") but the index {idx!r} is not in "
                                        f"xl/sharedStrings.xml; the part is missing or shorter than expected")
                cell.update(kind="string", value=shared_strings[idx], raw=v_text)
            elif t == "inlineStr":
                cell.update(kind="string", value=_text(is_el), raw=_text(is_el))
            elif t == "str":
                cell.update(kind="string", value=v_text or "", raw=v_text)
            elif t == "b":
                cell.update(kind="bool", value=(v_text == "1"), raw=v_text)
            elif t == "e":
                cell.update(kind="error", value=v_text, raw=v_text)
            else:  # "n" or anything numeric
                if v_text is None:
                    cell["kind"] = "empty"
                else:
                    try:
                        cell.update(kind="number", value=float(v_text), raw=v_text)
                    except ValueError:
                        raise WorkbookError(f"{ref} is typed numeric but holds {v_text!r}")
            cell["font_rgb"], cell["fill_rgb"] = style_colours(styles, s) if styles else (None, None)
            cells.append(cell)
    return cells


# ── the workbook as a whole ─────────────────────────────────────────────────

def read_workbook(path_or_bytes, name: str | None = None) -> dict:
    """Open an .xlsx (path or bytes) and parse every part this tool uses."""
    if isinstance(path_or_bytes, (bytes, bytearray)):
        data = bytes(path_or_bytes)
        file_name = name or "<bytes>"
    else:
        with open(path_or_bytes, "rb") as fh:
            data = fh.read()
        file_name = name or os.path.basename(str(path_or_bytes))
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise WorkbookError(f"{file_name} is not a zip archive, so not an .xlsx ({e})")
    names = set(zf.namelist())
    if "xl/workbook.xml" not in names:
        raise WorkbookError(f"{file_name} has no xl/workbook.xml; not a spreadsheetml package")

    wb = parse_workbook_xml(zf.read("xl/workbook.xml"))
    rels = parse_rels(zf.read("xl/_rels/workbook.xml.rels")) if "xl/_rels/workbook.xml.rels" in names else {}
    shared = parse_shared_strings(zf.read("xl/sharedStrings.xml")) if "xl/sharedStrings.xml" in names else None
    styles = parse_styles(zf.read("xl/styles.xml")) if "xl/styles.xml" in names else None

    app = {}
    if "docProps/app.xml" in names:
        root = ET.fromstring(zf.read("docProps/app.xml"))
        for tag in ("Application", "AppVersion"):
            found = _findall(root, tag)
            app[tag] = found[0].text if found else None
    core = {}
    if "docProps/core.xml" in names:
        root = ET.fromstring(zf.read("docProps/core.xml"))
        for tag in ("creator", "created", "modified"):
            found = _findall(root, tag)
            core[tag] = found[0].text if found else None

    sheets = []
    for s in wb["sheets"]:
        part = rels.get(s["rId"])
        if part is None or part not in names:
            raise WorkbookError(f"sheet {s['name']!r} points at relationship {s['rId']!r} whose part is missing")
        cells = parse_sheet(zf.read(part), shared, styles)
        sheets.append({"name": s["name"], "part": part, "state": s["state"], "cells": cells})

    media = []
    for n in sorted(names):
        if n.startswith("xl/media/"):
            blob = zf.read(n)
            media.append({"member": n, "bytes": len(blob), "md5": md5_hex(blob)})

    return {
        "file": file_name,
        "bytes": len(data),
        "sha256": sha256_hex(data),
        "md5": md5_hex(data),
        "members": len(names),
        "application": app.get("Application"),
        "app_version": app.get("AppVersion"),
        "creator": core.get("creator"),
        "created": core.get("created"),
        "modified": core.get("modified"),
        "calc_pr": wb["calcPr"],
        "shared_strings": (len(shared) if shared is not None else None),
        "styles": styles,
        "sheets": sheets,
        "media": media,
    }


def census(sheet: dict) -> dict:
    """Counts per sheet [Certain as counts of the parsed cells]."""
    cells = sheet["cells"]
    kinds = {k: 0 for k in ("formula", "number", "string", "bool", "error", "empty")}
    for c in cells:
        kinds[c["kind"]] += 1
    formula_cells = [c for c in cells if c["kind"] == "formula"]
    cached = [c["ref"] for c in formula_cells if c["cached"] is not None]
    blue = [c for c in cells if c["font_rgb"] == BLUE_RGB]
    green = [c for c in cells if c["font_rgb"] == GREEN_RGB]
    yellow = [c["ref"] for c in cells if c["fill_rgb"] == YELLOW_RGB]
    return {
        "cells": len(cells),
        "formula_cells": len(formula_cells),
        "formula_cells_with_cached_value": len(cached),
        "cached_refs": cached,
        "literal_numbers": kinds["number"],
        "strings": kinds["string"],
        "empty": kinds["empty"],
        "bools": kinds["bool"],
        "errors": kinds["error"],
        "blue_cells": len(blue),
        "blue_cells_with_formula": [c["ref"] for c in blue if c["kind"] == "formula"],
        "blue_literal_numbers": sum(1 for c in blue if c["kind"] == "number"),
        "green_cells": len(green),
        "green_cells_without_cross_sheet_formula": [
            c["ref"] for c in green if not (c["kind"] == "formula" and "!" in (c["formula"] or ""))],
        "yellow_fill_cells": yellow,
    }


def totals(per_sheet: dict) -> dict:
    keys = ("cells", "formula_cells", "formula_cells_with_cached_value", "literal_numbers", "strings",
            "empty", "blue_cells", "blue_literal_numbers", "green_cells")
    out = {k: sum(v[k] for v in per_sheet.values()) for k in keys}
    out["blue_cells_with_formula"] = sum(len(v["blue_cells_with_formula"]) for v in per_sheet.values())
    out["yellow_fill_cells"] = sum(len(v["yellow_fill_cells"]) for v in per_sheet.values())
    return out


# ── the ladder ───────────────────────────────────────────────────────────────

def _grid(sheet: dict) -> dict[tuple[str, int], dict]:
    return {(c["col"], c["row"]): c for c in sheet["cells"]}


def _string_at(grid, col, row) -> str | None:
    c = grid.get((col, row))
    return c["value"] if c and c["kind"] == "string" else None


def extract_ladder(workbook: dict, rows_map: dict) -> dict:
    """The fourteen ladder rows x three scenario columns, keyed by the row map, with the drift guard.
    Raises LadderError (a refusal) when the sheet does not hold what the map says."""
    sheet_name = rows_map.get("sheet", "Assumptions")
    sheet = next((s for s in workbook["sheets"] if s["name"] == sheet_name), None)
    if sheet is None:
        raise LadderError(f"no sheet named {sheet_name!r}; the workbook has "
                          f"{[s['name'] for s in workbook['sheets']]}. The row map "
                          f"({rows_map.get('source')}) reads the ladder from that sheet.")
    grid = _grid(sheet)
    columns: dict[str, str] = rows_map["columns"]
    scenarios: list[str] = rows_map["scenarios"]
    rows: dict[str, int] = rows_map["rows"]

    # Header row: column A says "Parameter", the scenario columns carry their names.
    header_row = None
    for (col, row), c in grid.items():
        if col == "A" and c["kind"] == "string" and c["value"] == HEADER_ROW_FIRST_CELL:
            header_row = row
            break
    if header_row is None:
        raise LadderError(f"no header row whose column A reads {HEADER_ROW_FIRST_CELL!r} on {sheet_name!r}")
    for name in scenarios:
        letter = columns[name]
        found = _string_at(grid, letter, header_row)
        if found != name:
            raise LadderError(f"header {letter}{header_row} reads {found!r}, expected the scenario column "
                              f"{name!r} (SCENARIOS/cols in {rows_map.get('source')})")

    problems = []
    out_rows = {}
    for key, row in rows.items():
        label = _string_at(grid, "A", row)
        guard = LABEL_GUARD.get(key)
        if guard is None:
            problems.append(f"row {row} ({key}): no LABEL_GUARD fragment for this key; add one before trusting it")
            continue
        if label is None or guard.lower() not in label.lower():
            problems.append(f"ladder row {row} ({key}): column A reads {label!r}, expected a label containing "
                            f"{guard!r}")
            continue
        values, raws, refs, blue = {}, {}, {}, True
        for name in scenarios:
            letter = columns[name]
            c = grid.get((letter, row))
            ref = f"{letter}{row}"
            if c is None or c["kind"] == "empty":
                problems.append(f"{ref} ({key}, {name}) is empty; a ladder cell must hold a number")
                continue
            if c["kind"] == "formula":
                problems.append(f"{ref} ({key}, {name}) holds the formula ={c['formula']}; a ladder cell must be a "
                                f"literal input (blue), not a result")
                continue
            if c["kind"] != "number":
                problems.append(f"{ref} ({key}, {name}) holds {c['value']!r} ({c['kind']}), not a number")
                continue
            values[name] = c["value"]
            raws[name] = c["raw"]
            refs[name] = ref
            blue = blue and (c["font_rgb"] == BLUE_RGB)
        if len(values) != len(scenarios):
            continue
        out_rows[key] = {
            "row": row,
            "label": label,
            "note": _string_at(grid, "E", row),
            "cells": refs,
            "values": values,
            "raw": raws,
            "blue": blue,
        }
    if problems:
        raise LadderError("the Assumptions sheet does not hold the ladder where the row map says:\n  - "
                          + "\n  - ".join(problems)
                          + "\n  What would help: re-read the sheet and update _LADDER_ROWS in "
                          f"{rows_map.get('source')} (and this tool's LABEL_GUARD) together, then re-run.")
    return {
        "sheet": sheet_name,
        "header_row": header_row,
        "columns": {name: columns[name] for name in scenarios},
        "rows_map_source": {"file": rows_map.get("source"), "lines": rows_map.get("lines")},
        "rows": out_rows,
    }


def extract_block(workbook: dict, sheet_name: str, header: str, stop_headers: tuple[str, ...]) -> dict:
    """Label -> value rows under a section header in column A (the shared design point, the
    physical constants): every row after the header whose A is a string and whose B is a literal
    number, until the next section header. Keys are slug(label) [this tool's choice]."""
    sheet = next((s for s in workbook["sheets"] if s["name"] == sheet_name), None)
    if sheet is None:
        return {"sheet": sheet_name, "header": header, "header_row": None, "entries": {}}
    grid = _grid(sheet)
    rows_in_a = sorted(r for (col, r) in grid if col == "A")
    start = None
    for r in rows_in_a:
        s = _string_at(grid, "A", r)
        if s and s.upper().startswith(header):
            start = r
            break
    entries = {}
    if start is None:
        return {"sheet": sheet_name, "header": header, "header_row": None, "entries": {}}
    for r in rows_in_a:
        if r <= start:
            continue
        label = _string_at(grid, "A", r)
        if label and any(label.upper().startswith(h) for h in stop_headers):
            break
        b = grid.get(("B", r))
        if label and b and b["kind"] == "number":
            key = slug(label)
            if key in entries:
                key = f"{key}_row{r}"
            entries[key] = {"row": r, "label": label, "cell": f"B{r}", "value": b["value"], "raw": b["raw"],
                            "note": _string_at(grid, "E", r), "blue": b["font_rgb"] == BLUE_RGB}
    return {"sheet": sheet_name, "header": header, "header_row": start, "entries": entries}


def legend(workbook: dict) -> str | None:
    """The colour legend sentence from the README sheet, if there is one."""
    for s in workbook["sheets"]:
        for c in s["cells"]:
            if c["kind"] == "string" and c["value"] and c["value"].startswith("Color code:"):
                return c["value"]
    return None


# ── putting it together ─────────────────────────────────────────────────────

def analyze(workbook: dict, rows_map: dict, provenance: dict | None = None) -> dict:
    per_sheet = {s["name"]: census(s) for s in workbook["sheets"]}
    tot = totals(per_sheet)
    ladder = extract_ladder(workbook, rows_map)
    design = extract_block(workbook, ladder["sheet"], DESIGN_POINT_HEADER, (CONSTANTS_HEADER, LADDER_HEADER))
    consts = extract_block(workbook, ladder["sheet"], CONSTANTS_HEADER, (DESIGN_POINT_HEADER, LADDER_HEADER))

    checks = []

    def check(name, ok, detail):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    n_rows, n_cols = len(ladder["rows"]), len(ladder["columns"])
    check("ladder-rows", n_rows == len(rows_map["rows"]),
          f"{n_rows} of {len(rows_map['rows'])} rows from {rows_map.get('source')} found where the map says, "
          f"labels match LABEL_GUARD")
    check("ladder-literals", True, f"all {n_rows * n_cols} ladder cells hold literal numbers (none is a formula)")
    not_blue = [k for k, r in ladder["rows"].items() if not r["blue"]]
    check("ladder-blue", not not_blue,
          f"all {n_rows * n_cols} ladder cells use the blue input font" if not not_blue
          else f"rows not styled as inputs (blue): {not_blue}")
    bf = tot["blue_cells_with_formula"]
    check("no-blue-formula", bf == 0,
          f"{tot['blue_cells']} blue cells, {bf} of them holding a formula" if bf
          else f"none of the {tot['blue_cells']} blue cells holds a formula")
    green_bad = sum(len(v["green_cells_without_cross_sheet_formula"]) for v in per_sheet.values())
    check("green-are-links", green_bad == 0,
          f"all {tot['green_cells']} green cells are formulas that reference another sheet" if not green_bad
          else f"{green_bad} green cells are not cross-sheet formulas")
    check("design-point", bool(design["entries"]),
          f"{len(design['entries'])} shared design-point rows under {DESIGN_POINT_HEADER!r}; "
          f"{len(consts['entries'])} physical constants under {CONSTANTS_HEADER!r}")

    cached = tot["formula_cells_with_cached_value"]
    if cached == 0:
        finding = (f"The committed workbook holds {tot['formula_cells']} formula cells and 0 cached results: every "
                   f"<v> under a formula is empty. The file carries inputs ({tot['literal_numbers']} literal "
                   f"numbers, {tot['blue_cells']} blue input cells) and formulas, not results. Any number quoted "
                   f"as a 'workbook result' was computed elsewhere: by a spreadsheet program that recalculated "
                   f"on open (calcPr fullCalcOnLoad={ (workbook['calc_pr'] or {}).get('fullCalcOnLoad') }) "
                   f"and was not saved back, or by finance/skyhook_finance.py.")
    else:
        finding = (f"The workbook holds {tot['formula_cells']} formula cells, {cached} of them with a cached result "
                   f"stored in the file; the rest store none.")

    return {
        "schema": "blue-cells/ladder/1",
        "tool": f"ladder_export.py {__version__}",
        "workbook": {k: workbook[k] for k in ("file", "bytes", "sha256", "md5", "members", "application",
                                               "app_version", "creator", "created", "modified", "calc_pr",
                                               "shared_strings", "media")}
        | {"sheets": [s["name"] for s in workbook["sheets"]], "legend": legend(workbook)},
        "ladder": ladder,
        "design_point": design,
        "constants": consts,
        "census": {"sheets": per_sheet, "totals": tot},
        "finding": finding,
        "checks": checks,
        "provenance": provenance,
    }


# ── text report ──────────────────────────────────────────────────────────────

def _pad(s, n, right=False):
    s = str(s)
    return s.rjust(n) if right else s.ljust(n)


def render_report(result: dict) -> str:
    wb = result["workbook"]
    L = result["ladder"]
    cols = list(L["columns"])
    lines = []
    lines.append(f"Blue Cells {__version__} — the Skyhook financial workbook read with zipfile + xml only")
    lines.append(f"Workbook  {wb['file']}  {wb['bytes']:,} bytes, {wb['members']} zip members")
    lines.append(f"  sha256  {wb['sha256']}")
    lines.append(f"  md5     {wb['md5']}  (binary, byte-for-byte; the hash finance/decision_grid.json carries as workbook_md5)")
    calc = wb.get("calc_pr") or {}
    lines.append(f"  written by {wb.get('application') or '?'} ({wb.get('creator') or '?'}), created {wb.get('created') or '?'}, "
                 f"modified {wb.get('modified') or '?'}")
    lines.append(f"  calcPr fullCalcOnLoad={calc.get('fullCalcOnLoad', '?')} calcId={calc.get('calcId', '?')}; "
                 f"shared strings: {'none (every string is inline)' if wb.get('shared_strings') is None else wb['shared_strings']}")
    prov = result.get("provenance") or {}
    if prov:
        lines.append(f"  provenance  {prov.get('repo')} {prov.get('path')} @ {str(prov.get('commit') or '')[:7]} "
                     f"({prov.get('commitDate')}); last changed {prov.get('pathLastChanged')}")
    lines.append(f"Sheets    {' | '.join(wb['sheets'])}")
    if wb.get("legend"):
        lines.append(f"Legend    {wb['legend']}")
    lines.append("")
    n = len(L["rows"])
    lines.append(f"Ladder    {L['sheet']}!{L['columns'][cols[0]]}{min(r['row'] for r in L['rows'].values())}:"
                 f"{L['columns'][cols[-1]]}{max(r['row'] for r in L['rows'].values())}  "
                 f"{n} rows x {len(cols)} columns, keyed by {L['rows_map_source']['file']} _LADDER_ROWS")
    w_key = max(len(k) for k in L["rows"]) + 2
    w_val = max(max(len(r["raw"][c]) for r in L["rows"].values()) for c in cols) + 2
    w_val = max(w_val, max(len(c) for c in cols) + 2)
    head = _pad("key", w_key) + "".join(_pad(c, w_val, right=True) for c in cols) + "  cells    label"
    lines.append("  " + head)
    for key, r in L["rows"].items():
        cells = f"{r['cells'][cols[0]]}:{r['cells'][cols[-1]]}"
        lines.append("  " + _pad(key, w_key) + "".join(_pad(r["raw"][c], w_val, right=True) for c in cols)
                     + "  " + _pad(cells, 7) + "  " + r["label"] + ("" if r["blue"] else "  [NOT BLUE]"))
    lines.append("")
    for block, title in ((result["design_point"], "Shared design point"), (result["constants"], "Physical constants")):
        e = block["entries"]
        if not e:
            lines.append(f"{title}: none found under {block['header']!r}")
            continue
        refs = [v["cell"] for v in e.values()]
        lines.append(f"{title}  {block['sheet']}!{refs[0]}:{refs[-1]}")
        w = max(len(k) for k in e) + 2
        for k, v in e.items():
            lines.append("  " + _pad(k, w) + _pad(v["raw"], 10, right=True) + "  " + _pad(v["cell"], 5) + "  " + v["label"]
                         + (f"  ({v['note']})" if v.get("note") else ""))
        lines.append("")
    cs = result["census"]["sheets"]
    tot = result["census"]["totals"]
    lines.append("Formula census (what the file stores)")
    hdr = ("sheet", "cells", "formulas", "cached", "numbers", "strings", "blue", "green", "yellow")
    widths = (22, 7, 10, 8, 9, 9, 6, 7, 8)
    lines.append("  " + "".join(_pad(h, w, right=(i > 0)) for i, (h, w) in enumerate(zip(hdr, widths))))
    for name, c in cs.items():
        row = (name, c["cells"], c["formula_cells"], c["formula_cells_with_cached_value"], c["literal_numbers"],
               c["strings"], c["blue_cells"], c["green_cells"], len(c["yellow_fill_cells"]))
        lines.append("  " + "".join(_pad(v, w, right=(i > 0)) for i, (v, w) in enumerate(zip(row, widths))))
    row = ("TOTAL", tot["cells"], tot["formula_cells"], tot["formula_cells_with_cached_value"], tot["literal_numbers"],
           tot["strings"], tot["blue_cells"], tot["green_cells"], tot["yellow_fill_cells"])
    lines.append("  " + "".join(_pad(v, w, right=(i > 0)) for i, (v, w) in enumerate(zip(row, widths))))
    yellow = [f"{n}!{r}" for n, c in cs.items() for r in c["yellow_fill_cells"]]
    if yellow:
        lines.append(f"  yellow fill (key assumption needing attention): {', '.join(yellow)}")
    if wb.get("media"):
        for m in wb["media"]:
            lines.append(f"  media: {m['member']} {m['bytes']:,} bytes md5 {m['md5']}")
    lines.append("")
    lines.append("Finding")
    lines.append("  " + result["finding"])
    lines.append("")
    passed = sum(1 for c in result["checks"] if c["ok"])
    lines.append(f"Checks    {passed} of {len(result['checks'])} passed")
    for c in result["checks"]:
        lines.append(f"  {'ok  ' if c['ok'] else 'FAIL'} {c['name']}: {c['detail']}")
    return "\n".join(lines) + "\n"


def to_json(result: dict) -> str:
    return json.dumps(result, indent=1, ensure_ascii=False) + "\n"


def to_js(result: dict, var: str = "BLUE_CELLS_DATA") -> str:
    return (f"// Written by ladder_export.py --js; the same JSON as ladder.json, as a classic script so the\n"
            f"// page works from file://. Do not edit by hand.\n"
            f"window.{var} = {json.dumps(result, indent=1, ensure_ascii=False)};\n")


# ── command line ─────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="ladder_export.py",
        description="Read the Skyhook financial workbook's input ladder with the standard library only, "
                    "write it as JSON with the workbook's hashes, and report what the file stores.",
        epilog="Exit 0: ladder extracted. Exit 1: refused (the sheet does not hold what the row map says; "
               "the message names the row, the label found and the label expected). Exit 2: usage or unreadable file.")
    p.add_argument("workbook", nargs="?", default=DEFAULT_WORKBOOK,
                   help=f"path to the .xlsx (default: the snapshot beside this script)")
    p.add_argument("--rows-map", default=DEFAULT_ROWS_MAP,
                   help="JSON with rows/scenarios/columns/sheet read from finance/skyhook_finance.py "
                        "(default: snapshots/ladder_rows.json)")
    p.add_argument("--out", metavar="FILE", help="write the JSON artefact here")
    p.add_argument("--js", metavar="FILE", help="also write the JSON as window.BLUE_CELLS_DATA for the page")
    p.add_argument("--provenance", metavar="FILE", help="a snapshot.mjs sidecar to embed in the output")
    p.add_argument("--format", choices=("text", "json"), default="text", help="what to print (default text)")
    p.add_argument("--quiet", action="store_true", help="print nothing on success")
    p.add_argument("--version", action="version", version=f"ladder_export.py {__version__}")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if not os.path.isfile(args.workbook):
        sys.stderr.write(f"ladder_export.py: no such workbook: {args.workbook}\n")
        return 2
    if not os.path.isfile(args.rows_map):
        sys.stderr.write(f"ladder_export.py: no such rows map: {args.rows_map}\n")
        return 2
    with open(args.rows_map, encoding="utf-8") as fh:
        rows_map = json.load(fh)
    provenance = None
    if args.provenance:
        if not os.path.isfile(args.provenance):
            sys.stderr.write(f"ladder_export.py: no such provenance sidecar: {args.provenance}\n")
            return 2
        with open(args.provenance, encoding="utf-8") as fh:
            provenance = json.load(fh)
    try:
        wb = read_workbook(args.workbook)
        result = analyze(wb, rows_map, provenance)
    except LadderError as e:
        sys.stderr.write(f"ladder_export.py: REFUSED — {e}\n")
        return 1
    except WorkbookError as e:
        sys.stderr.write(f"ladder_export.py: cannot read the workbook — {e}\n")
        return 2
    except ET.ParseError as e:
        sys.stderr.write(f"ladder_export.py: a worksheet part is not well-formed XML: {e}\n")
        return 2
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(to_json(result))
    if args.js:
        with open(args.js, "w", encoding="utf-8") as fh:
            fh.write(to_js(result))
    if not args.quiet:
        if args.format == "json":
            sys.stdout.write(to_json(result))
        else:
            sys.stdout.write(render_report(result))
            if args.out:
                sys.stdout.write(f"Wrote {args.out}\n")
            if args.js:
                sys.stdout.write(f"Wrote {args.js}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
