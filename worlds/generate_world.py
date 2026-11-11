#!/usr/bin/env python3
"""Generate the Gazebo (SDF) world for the Precision Landing Lab.

Single source of truth: viewer/scene/city.json (see viewer/scene/README.md).
The helper functions below are a line-by-line port of viewer/world-core.js, so
the viewer and the simulation show the same city. Python standard library only.

Usage:
    python3 worlds/generate_world.py [--city PATH] [--out PATH]

Frame: ENU, metres, origin = pad centre at street level (same as Gazebo).
"""
import argparse
import hashlib
import json
import math
import os
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DEFAULT_CITY = os.path.join(REPO, "viewer", "scene", "city.json")
DEFAULT_OUT = os.path.join(HERE, "generated", "vertiport_city.sdf")
TAG_TEXTURE = "../assets/tag36_11_00000.png"  # relative to the generated SDF file
TAG_PLATE_M = 0.9  # tag image (10 x 10 cells incl. white border) on the 1 m TLOF
WORLD_NAME = "vertiport_city"
FACADES = ["glass", "office", "brick", "concrete"]
M32 = 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Port of viewer/world-core.js (keep the same order of operations and of
# random-number draws; the filler buildings must match the viewer exactly).
# ---------------------------------------------------------------------------
def js_round(x):
    """JavaScript Math.round: round half up (Python round() is banker's)."""
    return math.floor(x + 0.5)


def rng(seed):
    """mulberry32. Returns a function that gives floats in [0, 1)."""
    state = [(int(seed) & M32) or 1]

    def imul(a, b):
        return (a * b) & M32

    def nxt():
        a = (state[0] + 0x6D2B79F5) & M32
        state[0] = a
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return nxt


def _is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _rect(r, where):
    if (not isinstance(r, list) or len(r) != 4 or not all(_is_num(v) for v in r)
            or not r[2] > r[0] or not r[3] > r[1]):
        raise ValueError(where + ": footprint must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0")
    return list(r)


def parse_city(obj):
    """Validate a parsed city.json and return a normalised copy."""
    if not isinstance(obj, dict):
        raise ValueError("city.json: expected a JSON object")
    if obj.get("schema_version") != 1:
        raise ValueError("city.json: unsupported schema_version")
    st = obj.get("streets")
    if not isinstance(st, dict):
        raise ValueError('city.json: missing "streets"')
    streets = {
        "pitch": st.get("pitch"), "offset": st.get("offset"), "road_width": st.get("road_width"),
        "lanes": int(st.get("lanes", 0)), "sidewalk_width": st.get("sidewalk_width"),
        "curb_height": st["curb_height"] if _is_num(st.get("curb_height")) else 0.15,
        "extent": int(st.get("extent", 0)),
    }
    p = streets["pitch"]
    if not isinstance(p, list) or len(p) != 2 or not all(_is_num(v) and v > 0 for v in p):
        raise ValueError("city.json: streets.pitch must be [px, py] > 0")
    o = streets["offset"]
    if not isinstance(o, list) or len(o) != 2 or not all(_is_num(v) for v in o):
        raise ValueError("city.json: streets.offset must be [x, y]")
    if (not _is_num(streets["road_width"]) or not _is_num(streets["sidewalk_width"])
            or streets["road_width"] <= 0 or streets["sidewalk_width"] < 0):
        raise ValueError("city.json: bad road_width / sidewalk_width")
    if streets["road_width"] + 2 * streets["sidewalk_width"] >= min(p):
        raise ValueError("city.json: streets leave no room for blocks")
    if streets["lanes"] < 1 or streets["extent"] < 0 or streets["extent"] > 6:
        raise ValueError("city.json: lanes >= 1 and 0 <= extent <= 6")

    blist = obj.get("buildings")
    if not isinstance(blist, list) or not blist:
        raise ValueError('city.json: "buildings" must be a non-empty array')
    ids = set()
    buildings = []
    for i, b in enumerate(blist):
        w = "city.json: buildings[%d]" % i
        if not isinstance(b, dict) or not isinstance(b.get("id"), str) or not b["id"]:
            raise ValueError(w + ": needs a string id")
        if b["id"] in ids:
            raise ValueError(w + ": duplicate id " + b["id"])
        ids.add(b["id"])
        h = b.get("height")
        if not _is_num(h) or h <= 0 or h > 500:
            raise ValueError(w + ": height must be in (0, 500] m")
        facade = b.get("facade", "office")
        if facade not in FACADES:
            raise ValueError(w + ": facade must be one of " + ", ".join(FACADES))
        setbacks = []
        for k, s in enumerate(b.get("setbacks") or []):
            if (not isinstance(s, dict) or not _is_num(s.get("at")) or not _is_num(s.get("inset"))
                    or s["inset"] <= 0 or s["at"] <= 0 or s["at"] >= h):
                raise ValueError(w + ".setbacks[%d]: needs 0 < at < height and inset > 0" % k)
            setbacks.append({"at": s["at"], "inset": s["inset"]})
        setbacks.sort(key=lambda s: s["at"])
        buildings.append({"id": b["id"], "footprint": _rect(b.get("footprint"), w), "height": h,
                          "facade": facade, "setbacks": setbacks, "role": b.get("role")})

    v = obj.get("vertiport")
    if not isinstance(v, dict):
        raise ValueError('city.json: missing "vertiport"')
    host = next((b for b in buildings if b["id"] == v.get("building")), None)
    if host is None:
        raise ValueError("city.json: vertiport.building must name a building id")
    pad = v.get("pad") or {}
    if not all(_is_num(pad.get(k)) for k in ("x", "y", "z")):
        raise ValueError("city.json: vertiport.pad needs x, y, z")
    deck = v["deck_height"] if _is_num(v.get("deck_height")) else 0.9
    if abs(host["height"] + deck - pad["z"]) > 0.05:
        raise ValueError("city.json: vertiport.pad.z must equal building height + deck_height")
    fp = host["footprint"]
    if pad["x"] <= fp[0] or pad["x"] >= fp[2] or pad["y"] <= fp[1] or pad["y"] >= fp[3]:
        raise ValueError("city.json: the pad must lie inside the vertiport building footprint")
    sizes = {"tlof": v.get("tlof") or 1, "fato": v.get("fato") or 2, "safety_area": v.get("safety_area") or 3}
    if not sizes["tlof"] < sizes["fato"] < sizes["safety_area"]:
        raise ValueError("city.json: need tlof < fato < safety_area")
    wind = v.get("wind") or {}
    parapet = {"height": 1.0, "thickness": 0.3}
    parapet.update(v.get("parapet") or {})
    stair = v.get("stair_tower")
    vertiport = {
        "building": host["id"],
        "pad": {"x": pad["x"], "y": pad["y"], "z": pad["z"],
                "yaw_deg": pad["yaw_deg"] if _is_num(pad.get("yaw_deg")) else 0},
        "deck_height": deck, "tlof": sizes["tlof"], "fato": sizes["fato"], "safety_area": sizes["safety_area"],
        "net_width": v["net_width"] if _is_num(v.get("net_width")) else 0.5,
        "parapet": parapet,
        "stair_tower": ({"footprint": _rect(stair.get("footprint"), "vertiport.stair_tower"),
                         "height": stair.get("height") or 3} if stair else None),
        "hvac": [{"footprint": _rect(h.get("footprint"), "vertiport.hvac[%d]" % k), "height": h.get("height") or 1.5}
                 for k, h in enumerate(v.get("hvac") or [])],
        "windsock": dict({"mast_height": 1.2, "length": 0.4}, **v["windsock"]) if v.get("windsock") else None,
        "wind": {"from_deg": wind["from_deg"] if _is_num(wind.get("from_deg")) else 0,
                 "speed_mps": wind["speed_mps"] if _is_num(wind.get("speed_mps")) else 0},
        "approach_from_deg": v["approach_from_deg"] if _is_num(v.get("approach_from_deg")) else 180,
    }
    plaza = obj.get("plaza")
    ctx = obj.get("context")
    if ctx:
        ctx = dict({"seed": 1, "extent": streets["extent"], "min_height": 10, "max_height": 45,
                    "tower_chance": 0.1, "tower_height": 70}, **ctx)
    return {
        "schema_version": 1, "name": obj.get("name") or "", "streets": streets, "buildings": buildings,
        "vertiport": vertiport,
        "plaza": {"footprint": _rect(plaza.get("footprint"), "plaza"), "trees": int(plaza.get("trees", 0))} if plaza else None,
        "context": ctx,
    }


def street_lines(city):
    s = city["streets"]
    xs, ys = [], []
    for k in range(-s["extent"], s["extent"] + 2):
        xs.append(s["offset"][0] + k * s["pitch"][0])
        ys.append(s["offset"][1] + k * s["pitch"][1])
    return xs, ys


def city_blocks(city):
    s = city["streets"]
    xs, ys = street_lines(city)
    hw, sw = s["road_width"] / 2, s["sidewalk_width"]
    out = []
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            outer = [xs[i] + hw, ys[j] + hw, xs[i + 1] - hw, ys[j + 1] - hw]
            inner = [outer[0] + sw, outer[1] + sw, outer[2] - sw, outer[3] - sw]
            out.append({"i": i - s["extent"], "j": j - s["extent"], "outer": outer, "inner": inner})
    return out


def _overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def building_tiers(b):
    """Stacked boxes for one building: [{x0,y0,x1,y1,z0,z1}], narrowing at each setback."""
    out = []
    f = list(b["footprint"])
    z0 = 0
    for c in list(b.get("setbacks") or []) + [{"at": b["height"], "inset": 0}]:
        if c["at"] > z0:
            out.append({"x0": f[0], "y0": f[1], "x1": f[2], "y1": f[3], "z0": z0, "z1": c["at"]})
        z0 = c["at"]
        nf = [f[0] + c["inset"], f[1] + c["inset"], f[2] - c["inset"], f[3] - c["inset"]]
        if nf[2] - nf[0] >= 2 and nf[3] - nf[1] >= 2:
            f = nf
    return out


def approach_limit(city, x, y, from_deg):
    """Height limit of the 8:1 approach/departure surface at (x, y), or inf outside it."""
    v = city["vertiport"]
    p = v["pad"]
    a = from_deg * math.pi / 180
    ux, uy = math.sin(a), math.cos(a)
    dx, dy = x - p["x"], y - p["y"]
    along = dx * ux + dy * uy - v["fato"] / 2
    across = abs(-dx * uy + dy * ux)
    if along < 0 or along > 1219:
        return math.inf
    half = v["fato"] / 2 + ((152 / 2 - v["fato"] / 2) * along) / 1219
    if across > half:
        return math.inf
    return p["z"] + along / 8


def lowest_limit(city, f, direction):
    """Lowest approach-surface height over a footprint (sampled grid, same as the viewer)."""
    m = math.inf
    x = f[0]
    while x <= f[2] + 1e-9:
        y = f[1]
        while y <= f[3] + 1e-9:
            m = min(m, approach_limit(city, x, y, math.fmod(direction, 360)))
            y += max(0.5, (f[3] - f[1]) / 24)
        x += max(0.5, (f[2] - f[0]) / 24)
    return m


def context_buildings(city):
    """Filler buildings for every block without a listed building. Deterministic for a seed."""
    c = city["context"]
    if not c:
        return []
    R = rng(c["seed"])
    out = []
    listed = [b["footprint"] for b in city["buildings"]]
    appr = city["vertiport"]["approach_from_deg"]
    for blk in city_blocks(city):
        if max(abs(blk["i"]), abs(blk["j"])) > c["extent"]:
            continue
        if any(_overlaps(f, blk["inner"]) for f in listed):
            continue
        x0, y0, x1, y1 = blk["inner"]
        nx = 1 + math.floor(R() * 3)
        ny = 1 + math.floor(R() * 2)
        ring = max(abs(blk["i"]), abs(blk["j"]))
        for a in range(nx):
            for b in range(ny):
                if R() < 0.12:
                    continue
                gx = gy = 1.5
                bx0 = x0 + ((x1 - x0) * a) / nx + (gx if a else 0)
                bx1 = x0 + ((x1 - x0) * (a + 1)) / nx - (gx if a < nx - 1 else 0)
                by0 = y0 + ((y1 - y0) * b) / ny + (gy if b else 0)
                by1 = y0 + ((y1 - y0) * (b + 1)) / ny - (gy if b < ny - 1 else 0)
                tower = R() < c["tower_chance"]
                if tower:
                    h = c["tower_height"] * (0.8 + 0.4 * R())
                else:
                    h = c["min_height"] + (c["max_height"] - c["min_height"]) * math.pow(R(), 1.4)
                h *= 0.85 if ring >= 3 else 1
                fp = [bx0, by0, bx1, by1]
                lim = min(lowest_limit(city, fp, appr), lowest_limit(city, fp, appr + 180))
                h = min(h, lim - 1)
                h = js_round(h * 2) / 2
                if h < 6:
                    continue
                facade = FACADES[math.floor(R() * len(FACADES))]
                setbacks = []
                if h > 30 and R() < 0.5:
                    setbacks = [{"at": js_round(h * (0.6 + 0.2 * R())), "inset": 2}]
                out.append({"id": "ctx-%d-%d-%d%d" % (blk["i"], blk["j"], a, b), "footprint": fp,
                            "height": h, "facade": facade, "setbacks": setbacks, "role": "context"})
    return out


def approach_obstacles(city, extra=None):
    """Building tiers that rise above the preferred or reciprocal approach surface."""
    v = city["vertiport"]
    hits = []
    allb = list(city["buildings"]) + list(extra or [])
    for d in (v["approach_from_deg"], (v["approach_from_deg"] + 180) % 360):
        for b in allb:
            if b["id"] == v["building"]:
                continue
            for t in building_tiers(b):
                hit = False
                x = t["x0"]
                while x <= t["x1"] + 1e-9 and not hit:
                    y = t["y0"]
                    while y <= t["y1"] + 1e-9:
                        if t["z1"] > approach_limit(city, x, y, d):
                            hits.append({"id": b["id"], "dir": d})
                            hit = True
                            break
                        y += max(0.5, (t["y1"] - t["y0"]) / 24)
                    x += max(0.5, (t["x1"] - t["x0"]) / 24)
    return hits


# ---------------------------------------------------------------------------
# SDF output
# ---------------------------------------------------------------------------
def num(x):
    """Fixed, locale-free number format (deterministic output)."""
    s = ("%.6f" % x).rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def vec(*xs):
    return " ".join(num(x) for x in xs)


def safe_name(s):
    return "".join(ch if ch.isalnum() else "_" for ch in s)


def sub(parent, tag, text=None, **attrs):
    e = ET.SubElement(parent, tag, attrs)
    if text is not None:
        e.text = text
    return e


def comment(parent, text):
    parent.append(ET.Comment(" " + text.replace("--", "- -") + " "))


MATERIALS = {  # name: (r, g, b)  simple colours, visual only
    "glass": (0.35, 0.50, 0.60), "office": (0.60, 0.62, 0.66), "brick": (0.60, 0.30, 0.22),
    "concrete": (0.62, 0.62, 0.60), "asphalt": (0.12, 0.12, 0.13), "sidewalk": (0.55, 0.55, 0.53),
    "plaza": (0.50, 0.58, 0.45), "deck": (0.50, 0.50, 0.52), "net": (0.15, 0.35, 0.15),
    "sa": (0.90, 0.75, 0.10), "fato": (0.45, 0.45, 0.47), "tlof": (0.20, 0.20, 0.22),
    "equipment": (0.70, 0.70, 0.72), "mast": (0.90, 0.35, 0.10),
}


def material(parent, name):
    r, g, b = MATERIALS[name]
    m = sub(parent, "material")
    sub(m, "ambient", vec(r, g, b, 1))
    sub(m, "diffuse", vec(r, g, b, 1))
    sub(m, "specular", vec(0.1, 0.1, 0.1, 1))
    return m


def add_box(link, name, size, pose, mat, collision=True):
    if collision:
        col = sub(link, "collision", name=name + "_col")
        sub(col, "pose", vec(*pose))
        sub(sub(col, "geometry"), "box").append(_size(size))
    vis = sub(link, "visual", name=name)
    sub(vis, "pose", vec(*pose))
    sub(sub(vis, "geometry"), "box").append(_size(size))
    material(vis, mat)
    return vis


def _size(size):
    e = ET.Element("size")
    e.text = vec(*size)
    return e


def static_model(world, name, pose=(0, 0, 0, 0, 0, 0)):
    m = sub(world, "model", name=name)
    sub(m, "static", "true")
    sub(m, "pose", vec(*pose))
    link = sub(m, "link", name="link")
    return m, link


def add_building(world, b):
    x0, y0, x1, y1 = b["footprint"]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    _, link = static_model(world, "bld_" + safe_name(b["id"]), (cx, cy, 0, 0, 0, 0))
    for k, t in enumerate(building_tiers(b)):
        size = (t["x1"] - t["x0"], t["y1"] - t["y0"], t["z1"] - t["z0"])
        pose = ((t["x0"] + t["x1"]) / 2 - cx, (t["y0"] + t["y1"]) / 2 - cy, (t["z0"] + t["z1"]) / 2, 0, 0, 0)
        add_box(link, "tier_%d" % k, size, pose, b["facade"])


def add_ground_and_streets(world, city):
    s = city["streets"]
    xs, ys = street_lines(city)
    hw = s["road_width"] / 2
    margin = 150.0
    gx0, gx1, gy0, gy1 = xs[0] - hw - margin, xs[-1] + hw + margin, ys[0] - hw - margin, ys[-1] + hw + margin
    m = sub(world, "model", name="ground")
    sub(m, "static", "true")
    link = sub(m, "link", name="link")
    size = vec(gx1 - gx0, gy1 - gy0)
    col = sub(link, "collision", name="ground_col")
    pl = sub(sub(col, "geometry"), "plane")
    sub(pl, "normal", "0 0 1")
    sub(pl, "size", size)
    vis = sub(link, "visual", name="asphalt")
    sub(vis, "pose", vec((gx0 + gx1) / 2, (gy0 + gy1) / 2, 0, 0, 0, 0))
    pl = sub(sub(vis, "geometry"), "plane")
    sub(pl, "normal", "0 0 1")
    sub(pl, "size", size)
    material(vis, "asphalt")
    # Blocks (sidewalk slabs) rise by curb_height above the road. Lane markings: see README, known gaps.
    _, blk_link = static_model(world, "city_blocks")
    ch = s["curb_height"]
    for blk in city_blocks(city):
        o = blk["outer"]
        name = "block_%d_%d" % (blk["i"], blk["j"])
        add_box(blk_link, name.replace("-", "m"), (o[2] - o[0], o[3] - o[1], ch),
                ((o[0] + o[2]) / 2, (o[1] + o[3]) / 2, ch / 2, 0, 0, 0), "sidewalk")
    if city["plaza"]:
        f = city["plaza"]["footprint"]
        add_box(blk_link, "plaza", (f[2] - f[0], f[3] - f[1], 0.02),
                ((f[0] + f[2]) / 2, (f[1] + f[3]) / 2, ch + 0.01, 0, 0, 0), "plaza", collision=False)


def add_vertiport(world, city):
    v = city["vertiport"]
    pad = v["pad"]
    host = next(b for b in city["buildings"] if b["id"] == v["building"])
    roof_z = host["height"]
    # --- pad model: its pose is the pad pose (deck top). Everything inside is pad-relative. ---
    m = sub(world, "model", name="vertiport_pad")
    sub(m, "static", "true")
    sub(m, "pose", vec(pad["x"], pad["y"], pad["z"], 0, 0, math.radians(pad["yaw_deg"])))
    link = sub(m, "link", name="link")
    sa, fato, tlof, nw = v["safety_area"], v["fato"], v["tlof"], v["net_width"]
    slab = 0.3
    add_box(link, "deck", (sa, sa, slab), (0, 0, -slab / 2, 0, 0, 0), "deck")
    leg = 0.2
    leg_len = pad["z"] - roof_z - slab
    for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        add_box(link, "leg_%d" % i, (leg, leg, leg_len),
                (sx * (sa / 2 - leg), sy * (sa / 2 - leg), -slab - leg_len / 2, 0, 0, 0), "deck")
    # Safety net shelf: 4 thin boxes around the safety area, just below the deck top (visual only).
    nz, nt = -0.1, 0.02
    reach = sa + 2 * nw
    for i, (sx, sy, sz_x, sz_y) in enumerate((
            (0, 1, reach, nw), (0, -1, reach, nw), (1, 0, nw, sa), (-1, 0, nw, sa))):
        px = sx * (sa / 2 + nw / 2)
        py = sy * (sa / 2 + nw / 2)
        add_box(link, "net_%d" % i, (sz_x, sz_y, nt), (px, py, nz, 0, 0, 0), "net", collision=False)
    # Surfaces: thin visual-only boxes stacked on the deck top (collision surface = deck top = pad z).
    t = 0.01
    add_box(link, "surface_safety_area", (sa, sa, t), (0, 0, t / 2, 0, 0, 0), "sa", collision=False)
    add_box(link, "surface_fato", (fato, fato, t), (0, 0, t * 1.5, 0, 0, 0), "fato", collision=False)
    add_box(link, "surface_tlof", (tlof, tlof, t), (0, 0, t * 2.5, 0, 0, 0), "tlof", collision=False)
    # AprilTag tag36h11 id 0 on the TLOF. Real image, see worlds/assets/README.md.
    comment(link, "AprilTag tag36h11 id 0 (BSD-2, AprilRobotics/apriltag-imgs). Texture orientation, "
                  "scale and sampling are UNVERIFIED until the M2 camera check.")
    tag = sub(link, "visual", name="apriltag_36h11_id0")
    sub(tag, "pose", vec(0, 0, t * 3 + 0.001, 0, 0, 0))
    pl = sub(sub(tag, "geometry"), "plane")
    sub(pl, "normal", "0 0 1")
    sub(pl, "size", vec(TAG_PLATE_M, TAG_PLATE_M))
    mat = sub(tag, "material")
    sub(mat, "ambient", "1 1 1 1")
    sub(mat, "diffuse", "1 1 1 1")
    pbr = sub(sub(mat, "pbr"), "metal")
    sub(pbr, "albedo_map", TAG_TEXTURE)
    sub(pbr, "metalness", "0")
    sub(pbr, "roughness", "1")

    # --- rooftop equipment of the host building (world frame; roof level = host height) ---
    _, rl = static_model(world, "vertiport_rooftop", (0, 0, roof_z, 0, 0, 0))
    top = building_tiers(host)[-1]
    pt, ph = v["parapet"]["thickness"], v["parapet"]["height"]
    w, d = top["x1"] - top["x0"], top["y1"] - top["y0"]
    cx, cy = (top["x0"] + top["x1"]) / 2, (top["y0"] + top["y1"]) / 2
    for name, size, px, py in (
            ("parapet_s", (w, pt), cx, top["y0"] + pt / 2), ("parapet_n", (w, pt), cx, top["y1"] - pt / 2),
            ("parapet_w", (pt, d - 2 * pt), top["x0"] + pt / 2, cy), ("parapet_e", (pt, d - 2 * pt), top["x1"] - pt / 2, cy)):
        add_box(rl, name, (size[0], size[1], ph), (px, py, ph / 2, 0, 0, 0), "concrete")
    boxes = [("stair_tower", v["stair_tower"])] if v["stair_tower"] else []
    boxes += [("hvac_%d" % i, h) for i, h in enumerate(v["hvac"])]
    for name, e in boxes:
        f = e["footprint"]
        add_box(rl, name, (f[2] - f[0], f[3] - f[1], e["height"]),
                ((f[0] + f[2]) / 2, (f[1] + f[3]) / 2, e["height"] / 2, 0, 0, 0), "equipment")
    ws = v["windsock"]
    if ws:
        vis = sub(rl, "visual", name="windsock_mast")
        sub(vis, "pose", vec(ws["x"], ws["y"], ws["mast_height"] / 2, 0, 0, 0))
        cyl = sub(sub(vis, "geometry"), "cylinder")
        sub(cyl, "radius", "0.03")
        sub(cyl, "length", num(ws["mast_height"]))
        material(vis, "mast")
        comment(rl, "The windsock cloth is not modelled (visual only in the viewer). See README, known gaps.")


def add_sun(world):
    # Same sun as the viewer 'day' preset: elevation 52 deg, azimuth 205 deg (from north, clockwise).
    e, a = math.radians(52), math.radians(205)
    to_sun = (math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e))
    light = sub(world, "light", type="directional", name="sun")
    sub(light, "cast_shadows", "true")
    sub(light, "pose", "0 0 100 0 0 0")
    sub(light, "diffuse", "1 0.96 0.9 1")
    sub(light, "specular", "0.3 0.3 0.3 1")
    sub(light, "direction", vec(*(-c for c in to_sun)))


def build_world(city, city_sha256=""):
    root = ET.Element("sdf", version="1.9")
    world = sub(root, "world", name=WORLD_NAME)
    comment(world, "GENERATED by worlds/generate_world.py from viewer/scene/city.json (sha256 %s). "
                   "Do not edit by hand. Frame: ENU, metres, origin = pad centre at street level." % city_sha256)
    phys = sub(world, "physics", name="1ms", type="ignore")
    sub(phys, "max_step_size", "0.001")
    sub(phys, "real_time_factor", "1.0")
    comment(world, "System plugin names below are the standard gz-sim 8 names. UNVERIFIED until the M2 load test.")
    for fn, nm in (("gz-sim-physics-system", "gz::sim::systems::Physics"),
                   ("gz-sim-user-commands-system", "gz::sim::systems::UserCommands"),
                   ("gz-sim-scene-broadcaster-system", "gz::sim::systems::SceneBroadcaster"),
                   ("gz-sim-imu-system", "gz::sim::systems::Imu")):
        sub(world, "plugin", filename=fn, name=nm)
    sens = sub(world, "plugin", filename="gz-sim-sensors-system", name="gz::sim::systems::Sensors")
    sub(sens, "render_engine", "ogre2")
    scene = sub(world, "scene")
    sub(scene, "ambient", "0.45 0.45 0.45 1")
    sub(scene, "background", "0.70 0.80 0.90 1")
    sub(scene, "shadows", "true")
    comment(world, "TODO(M2): spherical_coordinates (home lat/lon) are not set. ArduPilot SITL sets home; "
                   "decide in M2 whether the world needs it. Do not invent coordinates.")
    wind = city["vertiport"]["wind"]
    th = math.radians(wind["from_deg"])
    comment(world, "UNVERIFIED (M4): wind. The city.json default wind is from %s deg at %s m/s, which would be "
                   "ENU linear_velocity %s. The block below is a PLACEHOLDER with zero wind. Wind needs "
                   "enable_wind on each link and a verified force model in M4."
            % (num(wind["from_deg"]), num(wind["speed_mps"]),
               vec(-wind["speed_mps"] * math.sin(th), -wind["speed_mps"] * math.cos(th), 0)))
    w = sub(world, "wind")
    sub(w, "linear_velocity", "0 0 0")
    add_sun(world)
    add_ground_and_streets(world, city)
    for b in city["buildings"]:
        add_building(world, b)
    for b in context_buildings(city):
        add_building(world, b)
    add_vertiport(world, city)
    pad = city["vertiport"]["pad"]
    comment(world, "TODO(M2): add the vehicle here. Use the exact model name from the README of ardupilot_gazebo "
                   "at the pinned commit (docs/m0-proposal.md A8). The name is NOT guessed in this file. "
                   "Spawn above the pad, for example at x=%s y=%s z=%s, and add a downward camera "
                   "(gz-sim sensors system is already loaded above). Example shape of the include:"
            % (num(pad["x"]), num(pad["y"]), num(pad["z"] + 1)))
    comment(world, '<include><uri>model://TODO_M2_EXACT_MODEL_NAME_FROM_PLUGIN_README</uri>'
                   '<name>vehicle</name><pose>%s %s %s 0 0 0</pose></include>'
            % (num(pad["x"]), num(pad["y"]), num(pad["z"] + 1)))
    return root


def render(city_path):
    with open(city_path, "rb") as fh:
        raw = fh.read()
    city = parse_city(json.loads(raw.decode("utf-8")))
    root = build_world(city, hashlib.sha256(raw).hexdigest())
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", default=DEFAULT_CITY, help="path to city.json")
    ap.add_argument("--out", default=DEFAULT_OUT, help="path of the SDF file to write")
    args = ap.parse_args(argv)
    text = render(args.city)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print("wrote", os.path.relpath(args.out, REPO) if args.out.startswith(REPO) else args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
