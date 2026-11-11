# Vertiport design: what real ones look like, and what we simulate

Status: research note for M2 (world) and M3 (overlay) · 2026-11-11 · design sub-agent

Two public documents set out how a vertiport should look. The **FAA**
(United States) publishes Engineering Briefs and Advisory Circulars, and **EASA**
(European Union) published Prototype Technical Specifications. Both draw on
heliport design. This note keeps only the parts that make our small rooftop pad
look and behave like a real one.

Abbreviations: **TLOF** = touchdown and lift-off area (where the gear touches
down). **FATO** = final approach and take-off area (where the aircraft finishes
its approach and starts its climb). **SA** = safety area (an obstacle-free border
around the FATO). **D** = controlling dimension (the diameter of the smallest
circle around the aircraft, rotors turning). **RD** = rotor diameter (the smallest
circle around the lift propellers only).

## 1. Which document is current (as of 2026-11-11)

| Document | Status | Read here? |
|---|---|---|
| FAA **EB 105**, *Vertiport Design*, 21 Sep 2022 — "interim guidance" [1] | Superseded by EB 105A | **Yes, primary text** |
| FAA **EB 105A**, *Vertiport Design*, dated 27 Dec 2024 [2][3][4] | Current FAA interim guidance | No: faa.gov blocks automated fetches. Changes below come from trade press |
| FAA **Draft AC 150/5390-4**, *Vertical Flight Aircraft Infrastructure Design*, posted 22 Oct 2026, comments due 11 Jan 2027 [5][6] | Draft. Once final, it would cancel EB 105A and AC 150/5390-2D | No: blocked. Trade press only |
| EASA **PTS-VPT-DSN**, VFR vertiports for manned VTOL aircraft, Mar 2022 [7] | Prototype specification (guidance) | **Yes, primary text** |

EB 105 is the version whose text I could verify. EB 105A changed it in three ways
(per [3][4]). TLOF/FATO sizing now depends on RD rather than D. The safety area
got smaller. A downwash/outwash caution area was added. Its markings are also
reported as different: [3] says the broken-wheel symbol and EASA "V" were dropped
for a traditional "H", and [3][4] say "VTL" text is added. **UNVERIFIED** (I could
not open the primary text). The exact EB 105A multipliers are also **UNVERIFIED**.

## 2. Layout and sizing

All three areas are nested: the TLOF sits at the centre of the FATO, and the SA
surrounds the FATO.

| Element | FAA EB 105 (Table 2-1, §2.2) [1] | EASA PTS (C.210/C.220/C.260) [7] | FAA draft AC 150/5390-4 [6] |
|---|---|---|---|
| TLOF | **1 D** min; circle, square or rectangle; same shape as FATO/SA | **0.83 D** min; **elevated: must contain a 1 D circle** | RD + 10 ft (3 m) — **UNVERIFIED** |
| FATO | **2 D** | **1.5 D** min (or the flight-manual distance, if longer) | ≥ 1.5 × CD — **UNVERIFIED** |
| SA | **3 D** total (**½ D** beyond the FATO edge) | **0.25 D or 3 m**, whichever is greater, beyond the FATO | +0.28 CD, min 20 ft — **UNVERIFIED** |

More rules from EB 105 [1]:

- A pad is "elevated" if the TLOF/FATO sit at least 30 in (0.8 m) above the
  surrounding surface (§2.2, footnote).
- The TLOF is centred in its FATO, level, and load-bearing. It is designed for
  150 % of the maximum take-off weight as a dynamic load (§2.2).
- A rooftop TLOF should be concrete or metal, with a broomed (roughened) finish
  so it doesn't skid (§2.2.11).
- A square shape is preferred. A survey of EMS (air ambulance) pilots found a
  square gave the best cues for judging closure rate and attitude (§2.2
  footnote).
- Elevated pads should not use railings. Safety nets are optional: at least 5 ft
  (1.5 m) wide and rated for 50 lb/ft² (§2.3) [1].

EASA adds that safety nets or shelves must not rise above the TLOF (C.260(j)) [7].

## 3. Obstacle surfaces and approach/departure paths

- **FAA EB 105 §2.5.1** [1]:
  - The primary surface is the FATO itself.
  - The approach/departure surface starts at the FATO edge and rises at **8:1**
    (8 m out for each 1 m up) for **4,000 ft (1,219 m)**. It widens to **500 ft
    (152 m)** at its outer end.
  - Transitional surfaces rise from the sides at **2:1** for **250 ft (76 m)**.
- **Paths (§2.5.2)** [1]:
  - Align the paths with the prevailing wind.
  - Provide at least two paths, as close to reciprocal (opposite) as possible.
    If that's impossible, the two must be at least **135°** apart.
  - Paths may be curved.
- **EASA (D.410, Table D-1)** [7] has three slope categories: **A 4.5 %**,
  **B 8 % then 16 %**, and **C 12.5 %**. Each surface widens by **10 %** for day
  use and **15 %** for night use.
- **EASA's vertical alternative for cities is the obstacle-free volume (OFV, D.455)**
  [7]. The SA edges rise straight up to height **h1**, then flare outward as a
  funnel up to height **h2**.
  - The "Reference volume Type 1" (D.485) sets **h1 = 3 m** and **h2 = 30.5 m**.
  - Its top is **4 D** wide. The FATO is **2 D** at the base.
  - This is the "drop straight down into a rooftop" profile our copter flies.
- Draft AC (trade press [6]): **15:1** (or shallower) for powered-lift. The
  helicopter maximum stays at 8:1. **UNVERIFIED**.

## 4. Markings

| Marking | FAA EB 105 [1] | EASA PTS [7] |
|---|---|---|
| TLOF perimeter | **12 in (305 mm) solid white** line (§3.1) | Continuous **white**, ≥ **30 cm** wide (E.590) |
| FATO perimeter | **12 in white dashes, 5 ft (1.5 m) long, 5–6 ft gaps** (§3.1) | Markers **30 cm wide, 1.5 m long**, with spacing rules (E.560) |
| Identification | White **"broken wheel"** symbol at the TLOF centre, with an optional 10 × 2 ft bar showing the preferred approach (§3.2) | White **"V" in a blue circle** (E.520). On elevated/OFV pads it goes "within the FATO or TLOF" |
| Touchdown aim | — | **Touchdown/positioning circle (TDPC)**: inner diameter **0.5 D**, line ≥ **0.5 m** wide (E.600). Colour **UNVERIFIED** (ICAO heliport practice is yellow) |
| Limits | Size/weight box: black numbers on white, MTOW (kilo-pounds) above "D<n>" (§3.3) | Mass and D-value markings (E.540/E.550) |

Optional extras in EB 105 (§3.1) [1]: flight-path alignment arrows, and a 2–6 in
contrasting outline around markings to make them easier to see. EB 105 also
warns against overusing reflective paint, because it can blind a pilot using
landing lights.

## 5. Lighting and wind indicator

- **TLOF perimeter lights (FAA §3.5.2)** [1]:
  - **Green**, type L-861H/L-852H.
  - A square TLOF has **one light at each corner and at least 5 per side**,
    no more than **25 ft** apart, plus one on the approach centreline.
  - All lights within **1 ft (0.3 m)** of the perimeter line.
  - A circular TLOF has an even number, at least **8**.
- **FATO perimeter lights** are optional and also green (FAA) [1]. EASA allows
  white or green (E.760) [7].
- **Approach lights (optional, FAA)**: five green lights on the approach centreline.
  The first is 30–60 ft from the TLOF, then one every 15 ft [1].
- **Flight-path alignment lights**: at least three green lights, 5–10 ft apart [1].
- **Floodlights (FAA §3.5.5)**: mounted on nearby buildings, clear of every
  surface, aimed down, never into the pilot's eyes [1]. EASA permits green LED
  strips that outline the "V" and the TDPC (E.700s) [7].
- **Wind cone (FAA §3.7)** [1]:
  - **Orange**, built to AC 150/5345-27.
  - Visible from the TLOF and from **500 ft** out on the approach.
  - Within **500 ft** of the TLOF and outside the safety area.
- **Wind direction indicator (EASA E.510)** [7]:
  - A fabric truncated cone (a windsock).
  - For **elevated pads: ≥ 1.2 m long, 0.3 m → 0.15 m diameter**.
  - Single colour (white or orange) or **five bands, darker colour at both ends**.
  - Lit at night. On an elevated pad it may stand on a nearby structure.

## 6. What we'll simulate (scaled to our ~1 m pad)

**Scaling rule.** We set **design D = 1.0 m**. An ArduPilot SITL quadcopter is
roughly 0.5–0.6 m including props (**UNVERIFIED** for our pinned model: measure
it in M2), so D = 1.0 m leaves margin. We then use **FAA EB 105 ratios** because
they are simple and conservative.

| Item | Real-world reference | Our sim value | Treatment |
|---|---|---|---|
| TLOF | 1 D square [1] | **1.0 × 1.0 m**, broomed-concrete texture, 0.9 m (≥ 0.8 m) above roof deck → "elevated" | **Copy** |
| FATO | 2 D [1] | **2.0 × 2.0 m**, flush steel deck | **Copy** |
| Safety area | 3 D total, ½ D border [1] | **3.0 × 3.0 m**, kept clear (EASA's 3 m minimum does not scale and is ignored) | **Simplify** |
| Safety net | ≥ 1.5 m wide, not above TLOF [1][7] | 0.5 m mesh shelf just below deck level, around the SA | **Simplify** (visual only, no collision) |
| TLOF perimeter | 305 mm white (~2 % of a 15 m TLOF) [1] | **3 cm white** solid line | **Copy, scaled** (wider than 2 % so the camera sees it) |
| FATO perimeter | white dashes 1.5 m / 1.5–1.8 m [1] | **3 cm white dashes, 15 cm long, 15 cm gaps** | **Copy, scaled** |
| Touchdown circle | TDPC inner Ø 0.5 D [7] | **Yellow ring, inner Ø 0.50 m, 4 cm wide**, at the TLOF centre | **Copy** |
| **AprilTag** | (none in real standards) | **tag36h11, id 0, 0.24 m black edge + 1-cell white quiet zone (0.30 m total)**, centred **inside the TDPC ring** | **Our addition**. It sits where a real pilot's aim point is, so it reads as an "aiming mark", not a sticker |
| Identification | broken wheel / "V" / "H" (§1) | White **"V" in a blue circle**, Ø 0.24 m, in the FATO on the approach side, outside the TLOF | **Copy (EASA)**. Kept away from the tag so the detector never confuses them |
| Approach bar | 10 × 2 ft bar = preferred direction [1] | 0.25 × 0.05 m white bar under the "V" | **Copy** |
| Size/weight box | MTOW / D box [1] | "2 / D1" box (2 kg, D = 1 m), TLOF's lower-right corner | **Copy** (cosmetic) |
| TLOF lights | green, corners + ≥ 5 per side [1] | **16 green point lights** (4 corners + 3 between on each side), 2 cm outside the line | **Copy** |
| FATO lights | optional green [1] | 8 green lights, corners + midpoints | **Copy** |
| Floodlights | on adjacent structure [1] | 2 spot lights on the stair-tower roof, aimed down | **Simplify**. Used for M4 lighting scenarios |
| Approach lights | 5 green on centreline [1] | — | **Out of scope** |
| Windsock | elevated: ≥ 1.2 m, banded, outside SA [7] | **0.4 m, 5 bands orange/white** on a 1.2 m mast at a roof corner, outside the SA | **Copy, scaled**. Static in M2; may point into the wind in M4 |
| Obstacle surface | 8:1 approach, 2:1 transitional [1]; EASA OFV [7] | Rule for world-builders: the SA is clear up to 2 m, then a 1:1 funnel. Parapets and HVAC stay below the 8:1 line | **Simplify** (checked by eye, not by code) |
| Approach paths | ≥ 2, reciprocal or ≥ 135° apart [1] | One preferred path (into the default wind) + a reciprocal; the go-around climbs straight up, then departs on the preferred path | **Simplify** |
| Downwash zones, charging, egress | [1][6] | — | **Out of scope** |

**Where the tag goes, and why.** Real pads already have a touchdown aim mark: the
TDPC ring. Putting the tag inside that ring means a viewer sees a believable
vertiport whose "aim here" spot happens to be machine-readable. It also matches
EASA's rule that the identification marking goes in the FATO or TLOF on elevated
pads, without the tag competing with the "V". If later tests show a close-range
blind spot (the tag fills the frame below about 0.4 m), a second, smaller nested
tag can go in the tag's centre. That is optional for M3.

## Sources

1. FAA, *Engineering Brief No. 105, Vertiport Design*, 21 Sep 2022 (copy hosted by NBAA): https://nbaa.org/wp-content/uploads/aircraft-operations/emerging-technologies/advanced-air-mobility-aam/20220921-FAA-Engineering-Brief-105-Vertiport-Design.pdf
2. FAA, EB 105A landing page: https://www.faa.gov/airports/engineering/engineering_briefs/eb_105a_vertiports
3. Vertical Flight Society / evtol.news, "FAA publishes EB 105A vertiport design guide" (Jan 2025): https://evtol.news/news/faa-publishes-eb-105a-vertiport-design-guide
4. Urban Air Mobility News, "FAA publishes updated vertiport design engineering brief" (Jan 2025): https://www.urbanairmobilitynews.com/emerging-regulations/faa-publishes-updated-vertiport-design-engineering-brief/
5. FAA, Draft AC 150/5390-4 (PDF): https://www.faa.gov/documentLibrary/media/Advisory_Circular/draft-ac-150-5390-4-Vertical-Flight-industry.pdf
6. DroneXL, "FAA draft vertiport design standards AC 150/5390-4" (26 Oct 2026): https://dronexl.co/2026/10/26/faa-draft-vertiport-design-standards-ac-150-5390-4/
7. EASA, *Prototype Technical Specifications for the Design of VFR Vertiports … (PTS-VPT-DSN)*, Mar 2022: https://www.easa.europa.eu/en/downloads/136259/en

All figures in this repo are our own drawings. No figures were copied from these documents.
