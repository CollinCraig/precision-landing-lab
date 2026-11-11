"""Tests for worlds/generate_world.py. Python standard library only.

Run from the repository root:  python3 -m unittest discover -s worlds/tests -v
"""
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
WORLDS = os.path.dirname(HERE)
REPO = os.path.dirname(WORLDS)
sys.path.insert(0, WORLDS)

import generate_world as gw  # noqa: E402

CITY_PATH = os.path.join(REPO, "viewer", "scene", "city.json")
COMMITTED_SDF = os.path.join(WORLDS, "generated", "vertiport_city.sdf")
TOL = 1e-5


def floats(text):
    return [float(t) for t in text.split()]


class WorldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(CITY_PATH, "rb") as fh:
            cls.raw = fh.read()
        cls.city = gw.parse_city(json.loads(cls.raw.decode("utf-8")))
        cls.ctx = gw.context_buildings(cls.city)
        cls.text = gw.render(CITY_PATH)
        cls.root = ET.fromstring(cls.text.encode("utf-8"))
        cls.world = cls.root.find("world")

    # --- helpers ---
    def models(self, prefix=""):
        return [m for m in self.world.findall("model") if m.get("name", "").startswith(prefix)]

    def model_boxes(self, model):
        """Absolute boxes (x0, y0, z0, x1, y1, z1) of the visuals of a model with a zero-yaw pose."""
        mp = floats(model.find("pose").text)
        out = []
        for vis in model.iter("visual"):
            box = vis.find("geometry/box/size")
            if box is None:
                continue
            sx, sy, sz = floats(box.text)
            px, py, pz = floats(vis.find("pose").text)[:3]
            cx, cy, cz = mp[0] + px, mp[1] + py, mp[2] + pz
            out.append((cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2))
        return out

    # --- tests ---
    def test_parses_as_xml_and_sdf_version(self):
        self.assertEqual(self.root.tag, "sdf")
        self.assertGreaterEqual(float(self.root.get("version")), 1.9)
        self.assertEqual(self.world.get("name"), "vertiport_city")
        for tag in ("physics", "scene", "wind", "light"):
            self.assertIsNotNone(self.world.find(tag), tag)
        self.assertIsNotNone(self.world.find("model[@name='ground']"))

    def test_model_names_are_unique(self):
        names = [m.get("name") for m in self.world.findall("model")]
        self.assertEqual(len(names), len(set(names)))

    def test_building_count_matches_city_plus_filler(self):
        listed = self.city["buildings"]
        self.assertGreater(len(self.ctx), 0)
        self.assertEqual(len(self.models("bld_")), len(listed) + len(self.ctx))

    def test_building_poses_and_heights_match(self):
        expected = {"bld_" + gw.safe_name(b["id"]): b for b in self.city["buildings"] + self.ctx}
        got = {m.get("name"): m for m in self.models("bld_")}
        self.assertEqual(set(got), set(expected))
        for name, b in expected.items():
            boxes = self.model_boxes(got[name])
            tiers = gw.building_tiers(b)
            self.assertEqual(len(boxes), len(tiers), name)
            x0, y0, x1, y1 = b["footprint"]
            mp = floats(got[name].find("pose").text)
            self.assertAlmostEqual(mp[0], (x0 + x1) / 2, delta=TOL, msg=name)
            self.assertAlmostEqual(mp[1], (y0 + y1) / 2, delta=TOL, msg=name)
            self.assertAlmostEqual(mp[2], 0, delta=TOL, msg=name)
            for box, t in zip(boxes, tiers):
                for a, e in zip(box, (t["x0"], t["y0"], t["z0"], t["x1"], t["y1"], t["z1"])):
                    self.assertAlmostEqual(a, e, delta=TOL, msg=name)
            # independent check against the raw footprint and height
            self.assertAlmostEqual(boxes[0][0], x0, delta=TOL, msg=name)
            self.assertAlmostEqual(boxes[0][3], x1, delta=TOL, msg=name)
            self.assertAlmostEqual(boxes[0][1], y0, delta=TOL, msg=name)
            self.assertAlmostEqual(boxes[0][4], y1, delta=TOL, msg=name)
            self.assertAlmostEqual(boxes[0][2], 0, delta=TOL, msg=name)
            self.assertAlmostEqual(boxes[-1][5], b["height"], delta=TOL, msg=name)

    def test_listed_buildings_match_city_json_directly(self):
        with open(CITY_PATH, encoding="utf-8") as fh:
            raw = json.load(fh)
        for b in raw["buildings"]:
            m = self.world.find("model[@name='bld_%s']" % gw.safe_name(b["id"]))
            self.assertIsNotNone(m, b["id"])
            boxes = self.model_boxes(m)
            self.assertAlmostEqual(max(bx[5] for bx in boxes), b["height"], delta=TOL)

    def test_filler_generator_is_deterministic_and_seeded(self):
        self.assertEqual(gw.context_buildings(self.city), self.ctx)
        other = json.loads(self.raw.decode("utf-8"))
        other["context"]["seed"] += 1
        self.assertNotEqual(gw.context_buildings(gw.parse_city(other)), self.ctx)

    def test_rng_reference_values(self):
        # First mulberry32 outputs for seed 1, taken from viewer/world-core.js run with node.
        r = gw.rng(1)
        self.assertEqual([r() for _ in range(3)], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522])

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_filler_matches_viewer_exactly(self):
        script = (
            'const c=require("./viewer/world-core.js");const f=require("fs");'
            'const city=c.parseCity(JSON.parse(f.readFileSync("viewer/scene/city.json","utf8")));'
            "console.log(JSON.stringify(c.contextBuildings(city)));"
        )
        out = subprocess.run(["node", "-e", script], cwd=REPO, capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        js = json.loads(out.stdout)
        self.assertEqual(len(js), len(self.ctx))
        for a, b in zip(self.ctx, js):
            self.assertEqual(a["id"], b["id"])
            self.assertEqual(a["footprint"], b["footprint"], a["id"])
            self.assertEqual(a["height"], b["height"], a["id"])
            self.assertEqual(a["facade"], b["facade"], a["id"])
            self.assertEqual(a["setbacks"], b["setbacks"], a["id"])

    def test_pad_pose_matches(self):
        pad = self.city["vertiport"]["pad"]
        m = self.world.find("model[@name='vertiport_pad']")
        self.assertIsNotNone(m)
        x, y, z, roll, pitch, yaw = floats(m.find("pose").text)
        self.assertAlmostEqual(x, pad["x"], delta=TOL)
        self.assertAlmostEqual(y, pad["y"], delta=TOL)
        self.assertAlmostEqual(z, pad["z"], delta=TOL)
        self.assertAlmostEqual(yaw, math.radians(pad["yaw_deg"]), delta=TOL)
        self.assertEqual((roll, pitch), (0, 0))
        # pad z = host roof + deck height
        host = next(b for b in self.city["buildings"] if b["id"] == self.city["vertiport"]["building"])
        self.assertAlmostEqual(pad["z"], host["height"] + self.city["vertiport"]["deck_height"], delta=0.05)

    def test_pad_surfaces_and_tag(self):
        v = self.city["vertiport"]
        m = self.world.find("model[@name='vertiport_pad']")
        for name, size in (("surface_tlof", v["tlof"]), ("surface_fato", v["fato"]), ("surface_safety_area", v["safety_area"])):
            vis = m.find("link/visual[@name='%s']" % name)
            self.assertIsNotNone(vis, name)
            sx, sy, sz = floats(vis.find("geometry/box/size").text)
            self.assertAlmostEqual(sx, size, delta=TOL)
            self.assertAlmostEqual(sy, size, delta=TOL)
            self.assertLess(sz, 0.05)  # thin
            self.assertIsNone(vis.find("../collision[@name='%s_col']" % name))
        tag = m.find("link/visual[@name='apriltag_36h11_id0']")
        self.assertIsNotNone(tag)
        tex = tag.find("material/pbr/metal/albedo_map").text
        self.assertTrue(os.path.isfile(os.path.normpath(os.path.join(WORLDS, "generated", tex))), tex)
        self.assertLess(gw.TAG_PLATE_M, v["tlof"])

    def test_tag_image_is_the_vendored_original(self):
        path = os.path.join(WORLDS, "assets", "tag36_11_00000.png")
        with open(path, "rb") as fh:
            data = fh.read()
        self.assertEqual(hashlib.sha256(data).hexdigest(),
                         "48d811f770fc3595aaf5650a5fd8007843e7fece1f8fdcb94e0f113b4c9ed0c6")
        self.assertTrue(os.path.isfile(os.path.join(WORLDS, "assets", "LICENSE-apriltag-imgs.txt")))

    def test_generation_is_deterministic(self):
        self.assertEqual(gw.render(CITY_PATH), gw.render(CITY_PATH))
        self.assertEqual(gw.render(CITY_PATH), self.text)

    def test_committed_sdf_is_up_to_date(self):
        if not os.path.isfile(COMMITTED_SDF):
            self.skipTest("generated SDF is not present")
        with open(COMMITTED_SDF, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), self.text, "stale: run python3 worlds/generate_world.py")

    def test_no_building_penetrates_approach_surfaces(self):
        city = self.city
        self.assertEqual(gw.approach_obstacles(city, self.ctx), [])
        # Same rule applied to the boxes that are in the SDF file (not to the generator's own lists).
        host_model = "bld_" + gw.safe_name(city["vertiport"]["building"])
        v = city["vertiport"]
        for m in self.models("bld_"):
            if m.get("name") == host_model:
                continue
            for (x0, y0, _z0, x1, y1, z1) in self.model_boxes(m):
                for d in (v["approach_from_deg"], (v["approach_from_deg"] + 180) % 360):
                    nx = max(1, int(math.ceil((x1 - x0) / max(0.5, (x1 - x0) / 24))))
                    ny = max(1, int(math.ceil((y1 - y0) / max(0.5, (y1 - y0) / 24))))
                    for i in range(nx + 1):
                        for j in range(ny + 1):
                            lim = gw.approach_limit(city, x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, d)
                            self.assertLessEqual(z1, lim + TOL, m.get("name"))

    def test_obstacle_rule_detects_a_violation(self):
        # Self-check of the rule: a tall building in the approach corridor must be reported.
        bad = {"id": "bad", "footprint": [-1, -40, 1, -30], "height": 60, "facade": "glass", "setbacks": [], "role": None}
        self.assertTrue(gw.approach_obstacles(self.city, [bad]))

    def test_unverified_items_are_marked(self):
        self.assertIn("UNVERIFIED (M4)", self.text)
        self.assertIn("TODO(M2)", self.text)
        self.assertIn("TODO_M2_EXACT_MODEL_NAME_FROM_PLUGIN_README", self.text)
        # The include must stay commented out: the world must load without the vehicle.
        self.assertIsNone(self.world.find("include"))

    def test_no_personal_paths_in_output(self):
        for needle in ("/home/", "/Users/", "@"):
            self.assertNotIn(needle, self.text)

    def test_bad_city_is_rejected(self):
        bad = json.loads(self.raw.decode("utf-8"))
        bad["vertiport"]["pad"]["z"] += 5
        with self.assertRaises(ValueError):
            gw.parse_city(bad)


if __name__ == "__main__":
    unittest.main()
