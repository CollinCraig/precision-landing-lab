# Gazebo world generator

Procedures in this repository follow ASD-STE100 Simplified Technical English.

## What this directory makes

`generate_world.py` reads the city layout in `viewer/scene/city.json`. It writes one SDF 1.9 world file:
`worlds/generated/vertiport_city.sdf`. The replay viewer uses the same `city.json`. So the viewer and the simulation show the same place.

The world contains:

- A ground plane (road level, z = 0) and a sidewalk slab for each city block.
- A box model for each listed building. A building with setbacks has one box for each tier.
- Filler buildings. The generator is a port of `contextBuildings` in `viewer/world-core.js`. It uses the same seeded random numbers (mulberry32). The filler buildings have the same footprints and heights as in the viewer.
- The vertiport building, an elevated deck on four legs, and a safety net shelf.
- The safety area, FATO and TLOF as thin visual boxes on the deck. They are 3 m, 2 m and 1 m squares.
- An AprilTag tag36h11 id 0 on the TLOF. The image is the original from AprilRobotics/apriltag-imgs (BSD 2-Clause). See `assets/README.md`.
- The pad pose. The model `vertiport_pad` has the pad pose from `city.json`. The collision surface of the deck is at the pad z.
- Rooftop parapet, stair tower, HVAC boxes and a windsock mast.
- A sun with the same direction as the viewer day preset.
- A wind block. It is a placeholder with zero wind. It is marked UNVERIFIED for M4.
- A commented vehicle `<include>` with a TODO for M2.

The generator uses only the Python 3 standard library. The output is deterministic. The file has no timestamp.

## Generate the world

1. Open a terminal in the repository root.
2. Run `python3 worlds/generate_world.py`.
3. Make sure that the output says `wrote worlds/generated/vertiport_city.sdf`.

Options:

- `--city PATH` sets another `city.json`.
- `--out PATH` sets another output file.

Commit the new SDF file together with each change to `city.json`. A test fails when the committed SDF is not up to date.

## Run the tests

1. Open a terminal in the repository root.
2. Run `python3 -m unittest discover -s worlds/tests -v`.
3. Make sure that all tests pass.

The tests check these items:

- The SDF parses as XML and has version 1.9 or higher.
- The building count, the poses and the heights match `city.json` and the filler generator.
- The pad pose matches `city.json`.
- The generation is deterministic, and the committed SDF is up to date.
- No building rises above the 8:1 approach and departure surfaces (the viewer rule, FAA EB 105).
- The filler buildings match `viewer/world-core.js` exactly. This test runs when `node` is installed. Otherwise it is skipped.

## Change the city

1. Edit `viewer/scene/city.json`.
2. Run `node --test viewer/tests/`.
3. Run `python3 worlds/generate_world.py`.
4. Run the tests in this directory.

If you change the filler algorithm in `viewer/world-core.js`, change `context_buildings` in `generate_world.py` in the same way. The node test shows a difference.

## Known gaps

- Gazebo is not installed. The SDF was **not** loaded in Gazebo. Only XML and geometry checks ran. UNVERIFIED.
- The system plugin names (Physics, UserCommands, SceneBroadcaster, Imu, Sensors with ogre2) are the standard gz-sim 8 names. They are UNVERIFIED until the M2 load test.
- The tag texture path is relative to the SDF file (`../assets/tag36_11_00000.png`). Gazebo path resolution, texture orientation (mirror or rotation), pixel sharpness and detector readability are UNVERIFIED.
- The tag image size on the pad is 0.9 m, including a 1-pixel white border. The black tag edge is 0.72 m. The pad has no tag-size requirement yet.
- The wind block has zero wind. The wind model and force coupling are for M4. UNVERIFIED.
- No lane markings, street trees, street lights, plaza trees, windsock cloth or floodlights. They are visual only in the viewer.
- Parapets exist only on the vertiport building.
- The 8:1 approach surfaces are checked by the tests. They are not drawn in the world.
- Materials are plain colours. There are no window textures. The world has no `spherical_coordinates`.
- The deck thickness (0.3 m), leg size (0.2 m) and surface colours are simple design values. They are not from a standard.

## M2 follow-ups

1. Read the README of `ardupilot_gazebo` at the pinned commit (`docs/m0-proposal.md`, A8). Find the exact model name for the iris with gimbal or a downward camera. Replace the commented include in the generator (`TODO(M2)`).
2. Add the vehicle and the downward camera sensor. The Sensors system is already in the world.
3. Load the world in Gazebo Harmonic (gz-sim 8). Fix any SDF warning. Check the plugin names.
4. Check the tag in the camera image: orientation, scale and detection.
5. Decide whether the world needs `spherical_coordinates` for the ArduPilot home position.
6. Set the real-time factor and the physics step for ArduPilot SITL, and measure them.
