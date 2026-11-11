# City layout: `city.json` (schema version 1)

`city.json` describes the city block around the rooftop vertiport. The replay
viewer draws it (`viewer/world.js`). The M2 Gazebo world generator can read the
same file, so the viewer and the simulation show the same place.

The validator is `parseCity` in `viewer/world-core.js`. The tests are in
`viewer/tests/world.test.js`.

## Frame and units

- All lengths are in metres. All angles are in degrees.
- The frame is **ENU**: `x` = east, `y` = north, `z` = up. Gazebo uses the
  same convention.
- The origin is the pad centre at street level (`z = 0` is the street).
- A footprint is `[x0, y0, x1, y1]`: the south-west corner, then the
  north-east corner. `x1 > x0` and `y1 > y0`.
- The telemetry frame (`viewer.json`) is NED relative to home. Home is the pad.
  So telemetry `n` = city `y - pad.y`, `e` = city `x - pad.x`, `d` = `pad.z - z`.

## Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | int | Must be `1`. |
| `name`, `units`, `frame` | info | Not read by the code. |
| `streets` | object | The street grid. See below. |
| `buildings` | array | Buildings that the simulation should model. 1 or more. |
| `vertiport` | object | The pad and its rooftop equipment. See below. |
| `plaza` | object, optional | `{footprint, trees}`: a paved area with trees. |
| `street_trees` | object, optional | `{spacing, extent}`: trees along the sidewalks of blocks within `extent` blocks of the centre. |
| `street_lights` | object, optional | `{spacing, extent, height}`: street lights along the sidewalks. |
| `context` | object, optional | Visual-only filler buildings. See below. |

### `streets`

| Field | Meaning |
|---|---|
| `pitch` | `[px, py]`: distance between street centrelines, east-west and north-south. |
| `offset` | `[x, y]`: the `x` of one north-south street centreline and the `y` of one east-west street centreline. |
| `road_width` | Kerb-to-kerb width of each road. |
| `lanes` | Lanes per road (both directions together). Used for lane markings. |
| `sidewalk_width` | Sidewalk width inside each block. Buildings start at the inner edge. |
| `curb_height` | Height of the sidewalk above the road. |
| `extent` | Number of streets on each side of the centre (0 to 6). |

North-south street centrelines are at `x = offset[0] + k * pitch[0]` for
`k = -extent ... extent + 1`. East-west centrelines use `y` the same way.
A block is the area between 4 streets. Use `cityBlocks()` to get the blocks.

### `buildings[]`

| Field | Meaning |
|---|---|
| `id` | Unique string. |
| `footprint` | Ground footprint, `[x0, y0, x1, y1]`. |
| `height` | Height of the main roof above the street (0 < h <= 500). |
| `facade` | `glass`, `office`, `brick` or `concrete`. Sets the window grid and the material. |
| `setbacks` | Optional. `[{at, inset}]`: from height `at`, the footprint shrinks by `inset` on all 4 sides. A setback that leaves less than 2 m is ignored. |
| `role` | Optional. `vertiport` marks the host building. |

`buildingTiers(b)` turns one building into stacked boxes
`{x0, y0, x1, y1, z0, z1}`. A world generator can make one Gazebo box link
for each tier. Each roof also has a parapet: 0.9 m high and 0.3 m thick, or
the `vertiport.parapet` values for the host building.

### `vertiport`

| Field | Meaning |
|---|---|
| `building` | The `id` of the host building. |
| `pad` | `{x, y, z, yaw_deg}`: the pad centre. `z` is the deck top and must equal host `height + deck_height`. `yaw_deg` turns the pad markings; keep `0` (approach from the south). |
| `deck_height` | Height of the elevated deck above the roof (0.9 m, at least 0.8 m makes it "elevated" in FAA EB 105). |
| `tlof`, `fato`, `safety_area` | Square sizes, nested: 1, 2 and 3 m. |
| `net_width` | Width of the safety net shelf around the safety area, just below the deck top. |
| `parapet` | `{height, thickness}` for the host roof. |
| `stair_tower` | `{footprint, height, floodlights}`: stair / egress tower. The floodlights are on its corner nearest the pad and aim at the pad. |
| `hvac` | `[{footprint, height}]`: rooftop HVAC units. |
| `windsock` | `{x, y, mast_height, length}`: position on the roof, outside the safety area. |
| `wind` | `{from_deg, speed_mps}`: default wind. `from_deg` is the direction the wind blows from (0 = north). The URL can override it (`wind=<from_deg>,<m/s>`). |
| `approach_from_deg` | Direction of the preferred approach (180 = from the south). The reciprocal path is 180 degrees from it. |

The marking layout and colours follow `design/vertiport-concept.html`. The
real-world basis is in `docs/research/vertiport-design.md`.

### `context`

| Field | Meaning |
|---|---|
| `seed` | Seed for the deterministic random generator. |
| `extent` | Fill blocks up to this many blocks from the centre. |
| `min_height`, `max_height` | Height range of normal filler buildings. |
| `tower_chance`, `tower_height` | Chance of a tall tower, and its typical height. |

`contextBuildings(city)` fills every block that has no listed building. It
keeps every filler building below the 8:1 approach and departure surfaces.
Filler buildings are for the view only. A world generator can skip them, or it
can port the generator (mulberry32 random numbers, see `world-core.js`).

## Checks that the tests make

- The file parses, and the pad sits on its building at deck height.
- No two buildings overlap, and each building is inside a block.
- No building rises above the 8:1 approach or departure surface
  (`approachObstacles`). This rule comes from FAA EB 105, section 2.5.1.

## Change the layout

1. Edit `city.json`.
2. Run `node --test viewer/tests/`.
3. Make sure that all tests pass.
4. Open the viewer and look at the `City` camera.
