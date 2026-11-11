# AAM landing context: industry, regulation and related work

Status: research note for the README, primers and results pages · 2026-11-11 · research sub-agent

This note puts the lab in context. It covers four things: how Advanced Air Mobility (AAM)
programs approach landing, how regulators currently treat autonomy, which research and
open-source work this lab builds on, and what a simulation-only lab can honestly claim.
Vertiport geometry and markings (TLOF/FATO/SA, FAA EB 105/105A, EASA PTS-VPT-DSN) are
covered in [`vertiport-design.md`](vertiport-design.md) and are not repeated here.

Conventions: every claim carries a numbered source (list at the end). **UNVERIFIED** marks
a claim that comes only from secondary reporting, or that we could not confirm against a
primary document. Sources were gathered by web search on 2026-11-11; several faa.gov and
easa.europa.eu pages block automated fetches, so some primary documents were read only
through their search abstracts or through trade press.

---

## 1. How AAM / eVTOL programs approach vertiport landing

The public picture is consistent: **the first commercial passenger operations in the US and
Europe are piloted**, with automation used to reduce pilot workload; **fully autonomous
passenger flight is a later step**, pursued by a few programs (Wisk, EHang) and by defense
derivatives. Almost no company publishes how its aircraft actually perform the final
approach and touchdown, and none we found publishes a vision-based precision-landing method
in technical detail.

| Program | Landing approach (public sources only) | Vision / precision landing disclosed? |
|---|---|---|
| **Joby** (S4) | Initial service is piloted; Joby bought Xwing's autonomy division (Superpilot) in June 2024 to move toward more automation and, later, possibly pilot removal [1][2]. Xwing had flown >250 autonomous flights and ~500 autolandings on a modified Cessna 208B before the deal [2]. Superpilot was later demonstrated in a 2025 US Pacific defense exercise (>7,000 mi autonomous) [3] and on a turbine-electric demonstrator first flown 7 Nov 2025 [4]. | No. Autolanding is on runways (Caravan), not vertiports. A reported 2026 autonomous coast-to-coast Caravan flight [5] is **UNVERIFIED** (secondary sources only). |
| **Archer** (Midnight) | Flew >400 autonomous (uncrewed) test flights in 2024, then began piloted flights in June 2025 [6]. The certification path for Midnight is piloted. Archer works with Anduril on autonomous defense variants [6][7]. | No. |
| **Wisk** (Gen 6, Boeing subsidiary) | The only US passenger program that seeks FAA type certification for an **autonomous** aircraft from the start [8][9]. "Human oversight" model: a ground-based Multi-Vehicle Supervisor (MVS) is pilot-in-command of several aircraft, cannot fly them by hand, but can command diversions or a precautionary landing [10]. The Boeing/Wisk concept of operations names diversion vertiports and emergency landing zones as alternate landing sites [11]. Gen 6 first flew 16 Dec 2025 [12]. | No. The landing sensor suite and approach method are not public. A second Gen 6 first flight (May 2026) is **UNVERIFIED** (single secondary source). |
| **BETA** (ALIA) | Piloted aircraft with fly-by-wire controls that BETA describes as suitable for crewed and uncrewed use [13]. BETA announced integration of Near Earth Autonomy perception and guidance, with autonomy flight tests targeted for H1 2026 [13][14]. | Partly: "perception and guidance" is stated, but the method is not. Whether the 2026 tests happened is **UNVERIFIED**. |
| **EHang** (EH216-S) | Pilotless passenger aircraft, supervised from the ground. Received a CAAC type certificate in October 2023 (first for a passenger eVTOL), then standard airworthiness and production certificates [15][16]. The TC carries operating restrictions [17]. | EHang lists "Visual Positioning for Vertical Takeoff & Landing" as a feature [18], and trade press says a computer-vision system aids vertical landing [19]. The method, pad markings and accuracy are **not public**. |

**Takeaways for this lab.** (a) Real programs treat the final approach as safety-critical
and keep a human in or over the loop, at least at first. (b) A defined **abort / divert
path** (alternate vertiport, precautionary landing) is a core part of every autonomy
concept that is public [10][11]. Our "safe abort and go-around" requirement mirrors this.
(c) No program publishes a fiducial-marker landing method; our AprilTag pad is a research
and teaching device, not an industry practice.

---

## 2. Regulatory view of autonomy in AAM

### FAA (United States)

- **AAM Implementation Plan / Innovate28 (July 2023, v1.0).** A "living" plan to enable
  AAM operations at one or more sites by 2028 (Los Angeles Olympics) [20][21]. Early
  operations are **piloted**, on fixed routes, from existing heliports and airports, mostly
  under VFR [21]. Trade reporting states the plan does not address remotely piloted or
  autonomous aircraft [21] (we did not confirm the exact wording in the PDF: **UNVERIFIED**).
  We found no newer published version.
- **Powered-lift SFAR (final rule).** Announced 22 Oct 2024, published 21 Nov 2024
  (FR Doc. 2024-24886), effective 21 Jan 2025. It adds pilot certification and operating
  rules for powered-lift and a 10-year SFAR [22][23]. Aircraft keep type certification as a
  special class under 14 CFR 21.17(b) [24]. Press summaries say uncrewed / autonomous
  powered-lift is **outside its scope** [25]; the rule text has a section headed
  "Autonomous Powered-Lift" whose content we did not read (**UNVERIFIED**) [23].
- **Roadmap for AI Safety Assurance, v1 (mid-2024).** A short, living FAA document with
  guiding principles: work within the existing safety-assurance system, and distinguish
  "assuring AI" from "using AI to improve safety" [26][27]. It is not a rule. Reported
  milestone dates for later position papers are **UNVERIFIED** [27].
- **Part 108 (BVLOS) NPRM, Aug 2025.** For small/medium uncrewed aircraft, not passenger
  AAM, but it is where the FAA states that **primarily autonomous** flights would be the norm,
  and it relies on detect-and-avoid [28][29]. Final-rule status as of this date is
  **UNVERIFIED**.
- **Vertiport design**: EB 105/105A and draft AC 150/5390-4: see `vertiport-design.md`.

### EASA (European Union)

- **SC-VTOL (July 2019) and its Means of Compliance** (MOC Issue 2, May 2021, plus later
  MOCs). Two categories: *Basic* and *Enhanced*. Enhanced applies to commercial passenger
  transport and requires that no single failure is catastrophic and that the aircraft can
  **continue safe flight and landing at the destination or a suitable alternate vertiport**
  [30][31]. This "alternate vertiport" requirement is the regulatory root of our abort path.
  Later amendments were not checked (**UNVERIFIED**).
- **AI Roadmap 2.0 and AI Concept Paper Issue 2 (2024)**: "Guidance for Level 1 & 2
  machine-learning applications." Level 1 is assistance to a human; Level 2 is
  human-AI teaming under human oversight [32][33]. Computer-vision functions (for example
  auto-taxi with obstacle detection) are cited as Level 2 examples [33]. A Proposed Issue 03
  (June 2026) is reported by ICAO [34]; we did not read it (**UNVERIFIED** contents). Fully
  autonomous (Level 3) guidance is a later phase [33].

### NASA

- **Vision-based Approach and Landing (VAL / VALS).** NASA Ames (with Langley) fused
  camera measurements of landmarks and fiducials with an IMU in an EKF for GPS-degraded
  urban approaches; tested with X-Plane on a San Francisco vertiport model and with small-UAS
  flights at Armstrong [35][36][37]. NASA lists closing the loop to the flight controller as
  **future work** [37]. This is the closest public analogue to this lab.
- **High-Density Vertiplex (HDV).** A Langley-led AAM sub-project for a reference automation
  architecture for dense vertiport operations, progressing from simulation to small-UAS
  flight tests with fleet and vertiport-manager roles (2022–2024) [38][39].
- **Safe2Ditch (Langley, archived).** Onboard emergency-landing manager for small UAS; uses a
  camera to check that the chosen ditch site is clear on approach and re-plans if it is
  occupied [40][41]. Direct precedent for our "occupied pad → abort" scenario.
- **Wisk–NASA supervisor study.** Human-in-the-loop simulation of one supervisor managing
  three autonomous aircraft [10].

---

## 3. Related work (vision-based UAV landing)

1. **Saripalli, Montgomery, Sukhatme, "Vision-based Autonomous Landing of an Unmanned Aerial
   Vehicle," ICRA 2002**, doi:10.1109/ROBOT.2002.1013656: <https://robotics.usc.edu/publications/334/> [42]
   An autonomous helicopter detects a known-shape helipad with vision and lands on it with a
   behavior-based controller; GPS is used for the en-route part. *Relation:* the original
   form of our mission: GPS to the area, vision for the final descent.

2. **Olson, "AprilTag: A robust and flexible visual fiducial system," ICRA 2011**, and
   **Wang & Olson, "AprilTag 2," IROS 2016**: <https://april.eecs.umich.edu/pdfs/olson2011a.pdf>,
   <https://april.eecs.umich.edu/pdfs/wang2016iros.pdf> [43]
   Square binary tags with robust coding that give a full 6-DoF pose from one image; AprilTag 2
   is a faster detector with fewer false positives. *Relation:* our perception baseline.

3. **Garrido-Jurado et al., "Automatic generation and detection of highly reliable fiducial
   markers under occlusion" (ArUco), Pattern Recognition 47(6), 2014**,
   doi:10.1016/j.patcog.2014.01.005 [44]
   Generates marker dictionaries with maximal inter-marker distance and handles partial
   occlusion; ships in OpenCV. *Relation:* the main alternative fiducial family, and the one
   PX4's newer estimator documents [46].

4. **ArduPilot Precision Landing and the MAVLink Landing Target Protocol** (open source):
   <https://ardupilot.org/copter/docs/precision-landing-and-loiter.html>,
   <https://ardupilot.org/dev/docs/mavlink-precision-landing.html>,
   <https://mavlink.io/en/services/landing_target.html> [45]
   ArduPilot Copter fuses `LANDING_TARGET` messages from a companion computer
   (`PLND_TYPE=1`) during LAND; its estimator assumes a stationary target. *Relation:* our
   first guidance path, exactly as specified in the charter.

5. **PX4 Precision Landing and Vision Target Estimator** (open source):
   <https://docs.px4.io/main/en/advanced_features/precland>,
   <https://docs.px4.io/main/en/advanced_features/vision_target_estimator> [46]
   The classic `landing_target_estimator` fuses IR-LOCK and terrain height; the newer,
   experimental VTE fuses camera detections (for example ArUco) with GNSS. *Relation:* a
   second reference design for the same estimator problem; useful comparison in primers.

6. **Falanga et al., "Vision-based Autonomous Quadrotor Landing on a Moving Platform,"
   SSRR 2017**, doi:10.1109/SSRR.2017.8088164: <https://rpg.ifi.uzh.ch/docs/SSRR17_Falanga.pdf> [47]
   Fully onboard detection and motion estimation of a moving pad, with multi-sensor fusion and
   trajectory planning. *Relation:* shows what lies beyond our static rooftop pad; out of scope.

7. **Polvara et al., "Autonomous Quadrotor Landing using Deep Reinforcement Learning,"
   arXiv:1709.03339 (2017/2018)**: <https://arxiv.org/abs/1709.03339> [48]
   Hierarchical DQNs land on a marker from low-resolution downward images, trained with domain
   randomization in simulation. *Relation:* the "learning-based landing" contrast; the charter
   defers learned methods until the AprilTag baseline works.

8. **Kawamura, Kannan, Lombaerts, Ippolito, "Vision-Based Precision Approach and Landing for
   Advanced Air Mobility," AIAA SciTech 2022** (AIAA 2022-0497), doi:10.2514/6.2022-0497,
   with follow-ups on NTRS: <https://ntrs.nasa.gov/citations/20220017714> [35][36]
   NASA VAL work (see §2). *Relation:* the AAM-specific version of our problem; also uses
   simulated vertiports.

9. **Scherer, Chamberlain, Singh, "Autonomous landing at unprepared sites by a full-scale
   helicopter," Robotics and Autonomous Systems 60(12), 2012**:
   <https://www.ri.cmu.edu/pub_files/2012/9/1-s2.0-S0921889012001509-main.pdf> [49]
   Lidar-based landing-zone evaluation (slope, roughness, rotor clearance, approach/abort path)
   on a full-scale autonomous helicopter. *Relation:* the "landing-site safety check" idea at
   full scale; our occupied-pad check is a much simpler version.

10. **NASA Safe2Ditch**: <https://technology.nasa.gov/patent/LAR-TOPS-243> [40][41]
    Camera check of a landing site on short final, with re-planning if the site is occupied.
    *Relation:* precedent for our abort-on-occupied-pad logic.

---

## 4. What this lab can credibly claim

**Can show (with evidence in the repo):**
- A closed loop in software-in-the-loop simulation: camera → AprilTag pose → `LANDING_TARGET`
  → ArduPilot precision landing, on a modelled rooftop vertiport.
- Measured, seeded, repeatable results: touchdown error, success / abort rates and timings,
  across scenario sets (gusts, GPS noise, occupied pad, lighting) as modelled in Gazebo.
- That the abort and go-around logic triggers on the conditions it was designed for, and
  how often it triggers falsely, *in those scenarios*.
- Honest comparison of design options inside the same simulator (for example ArduPilot
  precision landing vs a custom GUIDED controller).
- An educational, inspectable implementation of ideas that public AAM work describes
  (vision-aided final approach, defined abort / divert path) [10][30][35].

**Cannot show (state these in the README):**
- Real-world performance. Simulated camera, lighting, wind, rotor downwash and sensor noise
  are simplifications; results do not transfer to hardware without testing.
- Safety, airworthiness or certifiability. Nothing here meets DO-178C/DO-254, SC-VTOL, or
  EASA learning-assurance guidance [30][32], and no regulator has reviewed it.
- Representativeness of an eVTOL. The vehicle is a multicopter in ArduPilot SITL, not a
  powered-lift aircraft; no industry program publishes its landing method to compare with (§1).
- That fiducial-marker landing is how AAM vertiports will work. No public program uses it;
  it is a controlled research baseline.
- Statistical guarantees outside the tested scenario distribution.

Suggested README wording: *"Simulation only. Results describe this software in modelled
conditions. They are not evidence of real-world or certifiable performance."*

---

## 5. Related work paragraph (ready for the README)

> Vision-guided landing of small aircraft on a marked pad is a long-studied problem, from
> early helicopter work at USC (Saripalli et al., 2002) to fiducial systems such as AprilTag
> (Olson, 2011; Wang & Olson, 2016) and ArUco (Garrido-Jurado et al., 2014). This lab uses
> the open-source precision-landing paths in ArduPilot and the MAVLink Landing Target
> protocol, which PX4 also implements. Learning-based landing (for example Polvara et al.,
> 2018) and moving-platform landing (Falanga et al., 2017) are deliberately out of scope for
> now. The closest AAM-specific work is NASA's Vision-based Approach and Landing System for
> GPS-degraded urban approaches (Kawamura et al., 2022), and NASA's Safe2Ditch and CMU's
> full-scale landing-zone evaluation (Scherer et al., 2012) inform our landing-site check.
> Industry eVTOL programs (Joby, Archer, Wisk, BETA, EHang) do not publish their final-approach
> methods; their public concepts stress human oversight and a defined divert or abort path,
> which this lab models as a safe go-around.

---

## Sources

1. Joby, "Joby Acquires Xwing Autonomy Division, Looks Ahead to Autonomous Flight," 4 Jun 2024. <https://www.jobyaviation.com/news/joby-acquires-xwing-autonomy-division-looks-ahead-to-autonomous-flight>
2. FLYING, "Joby Acquires Autonomous Flight Developer Xwing." <https://www.flyingmag.com/joby-acquires-autonomous-flight-developer-xwing>
3. Joby, "Joby Completes Landmark U.S. Defense Exercise with Autonomous Flight Technology," 2025. <https://www.jobyaviation.com/news/joby-completes-landmark-u.s.-defense-exercise-with-autonomous-flight-technology>
4. Joby, "Joby Celebrates First Flight of Turbine Electric Demonstrator Aircraft." <https://www.jobyaviation.com/news/joby-celebrates-first-flight-of-turbine-electric-demonstrator-aircraft>
5. AIAA (repost), "Joby Completes Autonomous Coast-to-Coast Flight with Cessna Caravan," 21 Sep 2026. <https://aiaa.org/2026/09/21/joby-completes-autonomous-coast-to-coast-flight-with-cessna-caravan/>
6. Military & Aerospace Electronics, "Archer's Midnight eVTOL makes first piloted flight," 2025. <https://militaryaerospace.com/commercial-aerospace/article/55294490/archers-midnight-evtol-makes-first-piloted-flight>
7. FLYING, "Archer Lends Electric Air Taxi Powertrain to Anduril's Omen Concept." <https://www.flyingmag.com/archer-electric-air-taxi-powertrain-anduril-omen>
8. Wisk, "Wisk Unveils World's First Self-Flying, Four-Seat… Air Taxi" (Gen 6), Oct 2022. <https://wisk.aero/newsroom/generation6>
9. AVweb, "Wisk Introduces Sixth-Generation Air Taxi." <https://avweb.com/aviation-news/wisk-introduces-sixth-generation-air-taxi/>
10. Wisk, "Putting the Human into Autonomous Flight with Human Oversight." <https://wisk.aero/newsroom/human-oversight>
11. Boeing / Wisk, "Concept of Operations for Uncrewed Urban Air Mobility." <https://www.boeing.com/resources/boeingdotcom/innovation/con-ops/docs/Concept-of-Operations-for-Uncrewed-Urban-Air-Mobility.pdf>
12. Wisk, "From Drawing Board to Debut: The First Flight of Gen 6." <https://wisk.aero/newsroom/from-drawing-board-to-debut-the-first-flight-of-gen-6>
13. BETA Technologies, "BETA Technologies Builds Out Autonomous Capabilities." <https://beta.team/stories/beta-technologies-builds-out-autonomous-capabilities>
14. Military & Aerospace Electronics, "BETA Technologies collaborates with Near Earth Autonomy…" <https://militaryaerospace.com/commercial-aerospace/news/55332384/beta-technologies-collaborates-with-near-earth-autonomy-on-for-defense-and-commercial-evtol-autonomous-operations>
15. FLYING, "China's EHang Earns World's First eVTOL Type Certificate." <https://www.flyingmag.com/chinas-ehang-earns-worlds-first-evtol-type-certificate/>
16. EHang, "Airworthiness Certification Process." <https://www.ehang.com/ehang216s/airworthiness/>
17. Vertical Flight Society, "A Small Step for EHang, a Giant Leap for eVTOL?" <https://evtol.news/news/a-small-step-for-ehang-a-giant-leap-for-evtol>
18. EHang, EH216-S product page. <https://www.ehang.com/ehang216s/>
19. Airport Technology, "EHang 216 Autonomous Aerial Vehicle." <https://www.airport-technology.com/projects/ehang-216-autonomous-aerial-vehicle/>
20. FAA, "Advanced Air Mobility Implementation Plan (Innovate28)," v1.0, Jul 2023. <https://www.faa.gov/sites/faa.gov/files/AAM-I28-Implementation-Plan.pdf>
21. FLYING, "FAA Releases Its Innovate28 Plan for AAM Integration by 2028." <https://www.flyingmag.com/faa-releases-its-innovate28-plan-for-aam-integration-by-2028/>
22. FAA, "Integration of Powered-Lift: Pilot Certification and Operations…" <https://www.faa.gov/newsroom/integration-powered-lift-pilot-certification-and-operations-miscellaneous-amendments>
23. Federal Register, FR Doc. 2024-24886, 21 Nov 2024. <https://www.federalregister.gov/documents/2024/11/21/2024-24886/integration-of-powered-lift-pilot-certification-and-operations-miscellaneous-amendments-related-to>
24. DLA Piper, "FAA's new rule charts a path for deployment, integration of air taxis," Oct 2024. <https://www.dlapiper.com/insights/publications/2024/10/faas-new-rule-charts-a-path-for-deployment-integration-of-air-taxis>
25. FLYING, "FAA Finalizes Rules for Powered-Lift Aircraft." <https://www.flyingmag.com/faa-finalizes-rules-for-powered-lift-aircraft/>
26. FAA, "Roadmap for Artificial Intelligence Safety Assurance," v1. <https://www.faa.gov/media/82891>
27. AIN FutureFlight, "FAA Issues First Artificial Intelligence Roadmap," Aug 2024. <https://www.ainonline.com/aviation-news/futureflight/2024-08-21/faa-issues-first-artificial-intelligence-roadmap>
28. DLA Piper, "FAA proposes comprehensive BVLOS UAS regulatory framework," Aug 2025. <https://www.dlapiper.com/en-us/insights/publications/2025/08/faa-proposes-comprehensive-bvlos-uas-regulatory-framework>
29. CSIS, "Beyond Line of Sight: How Part 108 Could Transform Commercial Drones." <https://www.csis.org/analysis/beyond-line-sight-how-part-108-could-transform-commercial-drones>
30. EASA, Special Condition SC-VTOL-01. <https://www.easa.europa.eu/en/downloads/99956/en>
31. Vertical Flight Society, "EASA Publishes SC-VTOL." <https://evtol.news/news/easa-publishes-sc-vtol>
32. EASA, "AI Concept Paper Issue 2: Guidance for Level 1 & 2 machine learning applications." <https://www.easa.europa.eu/en/document-library/general-publications/easa-artificial-intelligence-concept-paper-issue-2>
33. ICAO APAC DGCA59, IP 03-05, "EASA's approach to artificial intelligence in aviation," Oct 2024. <https://www.icao.int/sites/default/files/APAC/Meetings/DGCA/59th%20DGCA%20Meeting-%20Cebu%20Philipines-%2014%20to%2018%20October%202024/03-%20Information%20Papers/IP-03-05-EASA-EASA-S-APPROACH-TO-ARTIFICIAL-INTELLIGENCE-IN-AVIATION.pdf>
34. ICAO APAC DGCA61, DP 03-06, "EASA approach to artificial intelligence in aviation," 2026. <https://www.icao.int/sites/default/files/APAC/Meetings/2026/2026%20DGCA61/Agenda%20Item03-Aviation%20Safety/61-DP-03-06_EASA_EASA-APPROACH-TO-ARTIFICIAL-INTELLIGENCE-IN-AVIATION.pdf>
35. NASA NTRS 20220017714 (VSLAM / VAL for AAM). <https://ntrs.nasa.gov/citations/20220017714>
36. NASA NTRS, 2023 AIAA SciTech VALS presentation (cites AIAA 2022-0497). <https://ntrs.nasa.gov/api/citations/20220018454/downloads/2023%20AIAA%20Scitech%20VALS%20Presentation%20r5ek.pdf>
37. NASA Technology Transfer, "Vision-based Approach and Landing System (VALS)," TOP2-322. <https://technology.nasa.gov/patent/TOP2-322>
38. NASA Ames AOL, "High Density Vertiplex." <https://humanfactors.arc.nasa.gov/groups/AOL/research/hdv.php>
39. NASA NTRS 20240007438 (HDV flight test report). <https://ntrs.nasa.gov/citations/20240007438>
40. NASA, "Safe2Ditch" (archived project page). <https://www.nasa.gov/safe2ditch>
41. NASA Technology Transfer, "Safe2Ditch Technology," LAR-TOPS-243. <https://technology.nasa.gov/patent/LAR-TOPS-243>
42. Saripalli, Montgomery, Sukhatme, ICRA 2002. <https://robotics.usc.edu/publications/334/>
43. Olson, ICRA 2011 <https://april.eecs.umich.edu/pdfs/olson2011a.pdf>; Wang & Olson, IROS 2016 <https://april.eecs.umich.edu/pdfs/wang2016iros.pdf>
44. Garrido-Jurado et al., Pattern Recognition 2014 (course copy). <https://cs-courses.mines.edu/csci507/schedule/24/ArUco.pdf>
45. ArduPilot, "Precision Landing and Loiter" <https://ardupilot.org/copter/docs/precision-landing-and-loiter.html>; "MAVLink Precision Landing" <https://ardupilot.org/dev/docs/mavlink-precision-landing.html>; MAVLink "Landing Target Protocol" <https://mavlink.io/en/services/landing_target.html>
46. PX4, "Precision Landing" <https://docs.px4.io/main/en/advanced_features/precland>; "Vision Target Estimator" <https://docs.px4.io/main/en/advanced_features/vision_target_estimator>
47. Falanga et al., SSRR 2017. <https://rpg.ifi.uzh.ch/docs/SSRR17_Falanga.pdf>
48. Polvara et al., arXiv:1709.03339. <https://arxiv.org/abs/1709.03339>
49. Scherer, Chamberlain, Singh, RAS 2012. <https://www.ri.cmu.edu/pub_files/2012/9/1-s2.0-S0921889012001509-main.pdf>

### UNVERIFIED items (summary)

- Joby autonomous coast-to-coast Cessna 208 flight, Sep 2026 [5] (secondary source only).
- Second Wisk Gen 6 first flight, May 2026 (single secondary source; not cited as fact).
- Whether BETA / Near Earth Autonomy flight tests started in H1 2026 [14].
- EHang's vision-landing method, pad markings and accuracy (not public) [18][19].
- Exact Innovate28 wording on autonomy, and whether a newer version exists [20][21].
- Content of the "Autonomous Powered-Lift" section of FR Doc. 2024-24886 [23].
- FAA AI roadmap later milestone dates [27]; Part 108 final-rule status [28].
- Amendments to SC-VTOL after 2021 [30]; contents of EASA AI Concept Paper Proposed Issue 03 [34].
