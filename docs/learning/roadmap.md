# Learning roadmap — M1 to M5 and after

This roadmap tells you what to study for each milestone, and in which order.
It is written in ASD-STE100 Simplified Technical English.

## How to use this roadmap

- Do one study step in each session. Each step takes 30–60 min.
- Stop at the end of a step. Write a two-line note: "what I did" and "next step".
- For M1, use `docs/learning/m1-sessions.md`. It puts doing before reading. For later milestones, do the study steps for a milestone before you start your piece (this rule is under review).
- Use the check-yourself questions to find gaps. Do not search for the answers in the code.
- If a resource is too difficult, skip it. Come back to it after the next step.

All resources are free. The time for each resource is an estimate for the parts that this roadmap tells you to read or watch.
Links marked **UNVERIFIED** did not open when this roadmap was written (2026-11-11).
All other links opened at that date.

This roadmap gives no code for your pieces. Your pieces are:
`mission.py` (M1), AprilTag pose in the camera frame (M2),
camera → body → NED conversion (M3), abort and go-around logic (M3),
the evaluation seed set (M4) and the README "How it works" section (M5).

### What already exists in this repository

Use these first. This roadmap does not repeat them.

| Item | Topic | Time |
|---|---|---|
| [Primer 00 — SITL and MAVLink](../primers/00-sitl-and-mavlink.md) | SITL, MAVLink messages, modes, arming, NED, the M1 state machine | 10 min |
| [Explainer hub](../../learn/index.html) | Index of the interactive pages | 2 min |
| [01 — How a drone flies](../../learn/01-how-a-drone-flies.html) | Autopilot vs. script, modes, arming, MAVLink commands | 30 min |
| [02 — Frames: NED, body, camera](../../learn/02-frames-ned-body-camera.html) | Three frames, signs, the rotation idea | 30 min |
| [03 — Precision landing big picture](../../learn/03-precision-landing-big-picture.html) | Pipeline, `LANDING_TARGET`, estimator, target loss | 30 min |

### Summary of study time

| Milestone | Resources | Study steps | Estimated study time |
|---|---|---|---|
| M1 | 6 | 6 | 4 h |
| M2 | 6 | 8 | 5.5 h |
| M3 | 6 | 9 | 7 h |
| M4 | 6 | 6 | 4.5 h |
| M5 | 4 | 4 | 3 h |
| **Total** | **28** | **33** | **24 h** |

The study time is the sum of the study steps. The stretch section has 10 more resources. Its time is not in the total.

---

## M1 — First flight, no 3D

### Concepts you need

- **SITL.** The real ArduPilot code runs on your laptop with a physics model in place of the aircraft.
- **MAVLink messages.** Small typed packets go between your script and the autopilot. Each packet has a type, a system ID and fields.
- **Command protocol.** You send a command. The autopilot sends `COMMAND_ACK`. An ACK is not proof that the vehicle did the action.
- **Flight modes and arming.** GUIDED lets a script give commands. Pre-arm checks must pass before the motors turn on.
- **State machine.** A program that is in one state at a time. It moves to a new state only on a clear condition.
- **Timeouts and thresholds.** Each wait has a limit. "At 5 m" means "inside a tolerance band", not an exact value.

### Your piece

`mission.py`: connect, arm, GUIDED takeoff to 5 m, hold 5 s, land, wait for disarm.
The agents give you a skeleton (`mission.py` in the pilot repository), step-tagged failing tests, a primer and a hint ladder.

### Resources

| # | Resource | What to read or watch | Time |
|---|---|---|---|
| 1.1 | [ArduPilot — SITL simulator](https://ardupilot.org/dev/docs/sitl-simulator-software-in-the-loop.html) | Overview and the diagram of the parts | 30 min |
| 1.2 | [MAVLink — Overview](https://mavlink.io/en/about/overview.html) | The full page | 20 min |
| 1.3 | [MAVLink — Command protocol](https://mavlink.io/en/services/command.html) | `COMMAND_LONG`, `COMMAND_ACK`, result codes | 20 min |
| 1.4 | [MAVLink — Python (pymavlink) guide](https://mavlink.io/en/mavgen_python/) | Optional in M1. Read only the message names and fields. Your mission uses the `ap` object, not pymavlink. | 15 min |
| 1.5 | [ArduPilot — Copter commands in GUIDED mode](https://ardupilot.org/dev/docs/copter-commands-in-guided-mode.html) | Arm, takeoff and mode commands | 30 min |
| 1.6 | [Refactoring Guru — State pattern](https://refactoring.guru/design-patterns/state) | Optional. A linear mission needs an enum and a loop, not one class for each state. | 20 min |

Extra (optional): [ArduSub — pymavlink examples](https://www.ardusub.com/developers/pymavlink.html).
It is for a submarine, but the MAVLink calls are the same. Do not copy its mission logic.

### Study steps

| Step | Time | Do this | Checkpoint |
|---|---|---|---|
| 1 | 40 min | Read Primer 00. Then read resource 1.1. | Draw the SITL loop from memory. |
| 2 | 40 min | Do explainer 01. Read resource 1.2. | Name the parts of a MAVLink packet. |
| 3 | 40 min | Read resources 1.3 and 1.5. | List the commands that your mission sends, in order. |
| 4 | 45 min | Read resource 1.4. Connect to SITL and run `./learn listen` to print decoded messages. | You see mode and armed state change in the output. |
| 5 | 30 min | Read resource 1.6. Draw your states and transitions on paper. | Each arrow on your drawing has a condition and a timeout. |
| 6 | 45 min | Compare your drawing with the skeleton and the failing tests. | You know which test each state must make pass. |

### Check yourself

1. Which MAVLink message tells you that the motors are armed? How often does it arrive?
2. You get `MAV_RESULT_ACCEPTED` for takeoff, but the altitude does not change. What are two possible causes?
3. Why does each state in your machine need its own timeout and its own failure reason?
4. Why is a 5 % altitude tolerance better than a test for exactly 5.0 m?
5. What does your machine do if the link stops for 3 s during HOLD?

---

## M2 — 3D vertiport world and camera

### Concepts you need

- **Vectors and matrices.** A matrix moves a vector from one coordinate system to a different one.
- **Pinhole camera model.** A 3D point projects onto the image through the focal length and the principal point.
- **Camera intrinsics and distortion.** The camera matrix `K` and the distortion coefficients describe one camera.
- **Fiducial markers.** An AprilTag has a known size and a known ID. Its four corners give a pose.
- **Pose from points (PnP).** Known 3D corner positions plus their 2D image positions give rotation and translation.
- **Error statistics.** Mean, median and percentiles of the detection error against truth.

### Your piece

Detect the tag in recorded frames. Compute its position in the camera frame.
The agents score your result against simulator truth (offline mode).

### Resources

| # | Resource | What to read or watch | Time |
|---|---|---|---|
| 2.1 | [3Blue1Brown — Essence of linear algebra](https://www.3blue1brown.com/topics/linear-algebra) | Chapters 1–4 and 13 (change of basis) | 1 h 15 min |
| 2.2 | [First Principles of Computer Vision (YouTube)](https://www.youtube.com/@firstprinciplesofcomputerv3258) · [course site](https://fpcv.cs.columbia.edu/) | "Image formation" and "Camera calibration" lectures | 1 h 30 min |
| 2.3 | [OpenCV — Camera calibration tutorial](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html) | "Theory" part: `K` and distortion | 30 min |
| 2.4 | [OpenCV — Perspective-n-Point pose](https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html) | Problem statement and the frame figure | 30 min |
| 2.5 | [AprilTag — project page](https://april.eecs.umich.edu/software/apriltag) · [paper (Olson 2011)](https://april.eecs.umich.edu/media/pdfs/olson2011tags.pdf) | Page, then paper sections 1–3 | 1 h |
| 2.6 | [pupil-apriltags (Python bindings)](https://github.com/pupil-labs/apriltags) | README: inputs and output fields | 20 min |

Extra (optional): [Gazebo — Sensors](https://gazebosim.org/docs/latest/sensors/) and [ArduPilot — SITL with Gazebo](https://ardupilot.org/dev/docs/sitl-with-gazebo.html).
Optional deep course: [MIT OCW 18.06 Linear Algebra](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/).

### Study steps

| Step | Time | Do this | Checkpoint |
|---|---|---|---|
| 1 | 45 min | Watch resource 2.1, chapters 1–3. | Explain in two sentences what the columns of a matrix show. |
| 2 | 30 min | Watch resource 2.1, chapters 4 and 13. | Explain why the order of two rotations is important. |
| 3 | 45 min | Watch the image formation lectures in resource 2.2. | Draw the pinhole model. Mark the focal length and the image center. |
| 4 | 45 min | Watch the calibration lectures in resource 2.2. | Write the meaning of each entry of `K` in words. |
| 5 | 30 min | Read resource 2.3, "Theory" part. | Say what changes in the image if the focal length doubles. |
| 6 | 40 min | Read resource 2.5, the project page and paper sections 1–2. | Explain why the tag has a black border. |
| 7 | 40 min | Read resources 2.4 and 2.6. | Write down the inputs that pose needs and the units of each. |
| 8 | 45 min | Open five recorded frames. Find the tag corners by eye. Compare with the skeleton and tests. | You know the frame axes of the camera in this lab. |

### Check yourself

1. Which way do the x, y and z axes of the camera frame point in OpenCV? How is this different from body FRD?
2. Why do you need the real tag size in metres to get a distance? What happens to your distance if the size is 10 % too large?
3. A tag is near the edge of the image. Why can its error be larger than a tag in the center?
4. Your detector finds the tag in 90 % of frames. What other number do you need to call the detector "good"?
5. Why must offline mode score against truth, but camera mode must never read truth?

---

## M3 — Find and land on the vertiport

### Concepts you need

- **Rotation matrices and Euler angles.** Roll, pitch and yaw turn a vector between body and NED. Order and sign are important.
- **Frame chain.** A point goes from camera to body (fixed mount), then from body to local NED (attitude).
- **`LANDING_TARGET` and `MAV_FRAME`.** ArduPilot accepts the target in a stated frame. The frame field must match your numbers.
- **Estimator.** ArduPilot filters target positions over time. It uses a Kalman-type filter.
- **Feedback control.** The autopilot corrects position error. Gains, delay and noise change how well it lands.
- **Validity and confidence.** An estimate needs a "can I use this?" flag, not only a position.
- **Abort and go-around.** A safe landing system stops the descent and climbs when the conditions are wrong.

### Your pieces

1. Frame conversion camera → body → local NED. It gives a `TargetEstimate` with validity and confidence.
2. Abort and go-around logic.

### Resources

| # | Resource | What to read or watch | Time |
|---|---|---|---|
| 3.1 | [ArduPilot — Precision landing and loiter](https://ardupilot.org/copter/docs/precision-landing-and-loiter.html) | Full page, with the `PLND_` parameters | 40 min |
| 3.2 | [ArduPilot — MAVLink precision landing (dev)](https://ardupilot.org/dev/docs/mavlink-precision-landing.html) | Full page; then [`LANDING_TARGET`](https://mavlink.io/en/messages/common.html#LANDING_TARGET) and [`MAV_FRAME`](https://mavlink.io/en/messages/common.html#MAV_FRAME) | 40 min |
| 3.3 | [Modern Robotics (Lynch and Park) — free book and videos](https://hades.mech.northwestern.edu/index.php/Modern_Robotics) | Chapter 3, sections 3.1–3.2 (rotations, frames) | 2 h |
| 3.4 | [Brian Douglas — Understanding PID Control (YouTube)](https://www.youtube.com/playlist?list=PLn8PRpmsu08pQBgjxYFXSsODEF3Jqmm-y) | Parts 1–4 | 1 h |
| 3.5 | [Brian Douglas — Understanding Kalman Filters (YouTube)](https://www.youtube.com/playlist?list=PLn8PRpmsu08pzi6EMiYnR-076Mh-q3tWr) | Parts 1–3 | 45 min |
| 3.6 | [FAA — Airplane Flying Handbook](https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/airplane_handbook) | The go-around / rejected landing part of the approach chapter | 40 min |

Extra (optional): [ArduPilot — EKF overview](https://ardupilot.org/copter/docs/common-apm-navigation-extended-kalman-filter-overview.html),
[Steve Brunton — Control Bootcamp (YouTube)](https://www.youtube.com/playlist?list=PLMrJAkhIeNNR20Mz-VpzgfQs5zrYi085m),
[MIT OCW 16.30 Feedback Control Systems](https://ocw.mit.edu/courses/16-30-feedback-control-systems-fall-2010/).
The FAA handbook is for airplanes. Use it for the go-around idea only, not for drone values.

### Study steps

| Step | Time | Do this | Checkpoint |
|---|---|---|---|
| 1 | 30 min | Do explainers 02 and 03 again. | Answer their check-yourself questions without the scene. |
| 2 | 60 min | Read resource 3.3, section 3.1. | Explain what a rotation matrix is in your own words. |
| 3 | 60 min | Read resource 3.3, section 3.2.1. Do two examples by hand. | Rotate a point 90° about z by hand. Get the same result twice. |
| 4 | 40 min | Read resource 3.1. | List the parameters that change how precision landing behaves. |
| 5 | 40 min | Read resource 3.2 and the two MAVLink pages. | Say which fields of `LANDING_TARGET` you will fill in, and why. |
| 6 | 60 min | Watch resource 3.4, parts 1–4. | Explain what the P, I and D terms each do to an error. |
| 7 | 45 min | Watch resource 3.5, parts 1–3. | Explain why a filter can trust a sensor less when noise is high. |
| 8 | 40 min | Read resource 3.6. Write a list of abort triggers for a rooftop pad. | Each trigger has a measurable condition and a time limit. |
| 9 | 45 min | Draw your camera → body → NED chain on paper. Compare with the skeleton and tests. | Each arrow has a named rotation and its source of data. |

### Check yourself

1. The camera points down and the drone pitches nose down 10°. Does the pad move in NED? Does it move in the camera frame?
2. You apply roll, pitch and yaw in the wrong order. For which flight conditions is the error small, and when is it large?
3. Why is it dangerous to send an estimate with `valid = true` if no tag was seen for 2 s?
4. Name three abort triggers. For each, what is the safe action: hold, climb or go-around?
5. How do you show the validator that camera mode never read truth?

---

## M4 — AAM conditions

### Concepts you need

- **Random seeds.** A seed makes a random scenario repeatable. Development seeds and evaluation seeds stay separate.
- **Experiment design.** Change one condition at a time. Keep a baseline.
- **Success rate and uncertainty.** 8 of 10 is an estimate. A confidence interval shows how sure you are.
- **Failure analysis.** Find the first event that went wrong, not only the last one.
- **Vertiport operations.** Real vertiports have safety areas and rules for an occupied pad.

### Your piece

Design the evaluation seed set. Analyze one failure mode.

### Resources

| # | Resource | What to read or watch | Time |
|---|---|---|---|
| 4.1 | [Seeing Theory (Brown University)](https://seeing-theory.brown.edu/) | Chapters 1, 2 and 5 (frequentist inference) | 1 h |
| 4.2 | [MIT OCW 18.05 Probability and Statistics](https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/) | Class notes on the binomial distribution and confidence intervals | 1 h 30 min |
| 4.3 | [Binomial proportion confidence interval (Wikipedia)](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval) | Wald and Wilson intervals | 30 min |
| 4.4 | [NumPy — Random Generator](https://numpy.org/doc/stable/reference/random/generator.html) | Seeds and `default_rng` | 20 min |
| 4.5 | [ArduPilot — Using SITL for testing](https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html) | Wind and sensor failure simulation | 30 min |
| 4.6 | [FAA — EB 105A Vertiport design](https://www.faa.gov/airports/engineering/engineering_briefs/eb_105a_vertiports) | Summary; touchdown and safety areas | 40 min |

The lab's own research note is in `docs/research/vertiport-design.md`. Read it with resource 4.6.

### Study steps

| Step | Time | Do this | Checkpoint |
|---|---|---|---|
| 1 | 45 min | Do resource 4.1, chapters 1–2. | Explain the difference between probability and a measured rate. |
| 2 | 45 min | Do resource 4.1, chapter 5. Read resource 4.3. | Explain why 10 runs give a wide interval. |
| 3 | 45 min | Read the resource 4.2 notes on confidence intervals. | Say how many runs you need to make the interval half as wide. |
| 4 | 30 min | Read resources 4.4 and 4.5. | Say which conditions you can seed and which you cannot. |
| 5 | 45 min | Read resource 4.6 and the research note. | List two real operation rules that your scenarios can test. |
| 6 | 45 min | Draft your seed set on paper: conditions, levels, runs. | Each condition has a reason and a run count. |

### Check yourself

1. Why must the evaluation seeds stay hidden from development?
2. Condition A gives 9/10 and condition B gives 7/10. Is B worse? What do you need to say "yes"?
3. Why is "same seed, same result" not always true in this lab?
4. For an occupied pad, which result is a success: a landing, a wait or a go-around?
5. How do you choose which one failure mode to analyze first?

---

## M5 — Polish and release candidate

### Concepts you need

- **Explanation for a reader.** Write for a person who did not build the system.
- **Document types.** A tutorial, a how-to, a reference and an explanation have different jobs.
- **Honest claims.** Report the measured results and the limitations. Do not overclaim.
- **Simplified Technical English.** Short sentences, one meaning for each word, active voice.

### Your piece

Write the README "How it works" section in your own words.

### Resources

| # | Resource | What to read or watch | Time |
|---|---|---|---|
| 5.1 | [Google — Technical Writing One](https://developers.google.com/tech-writing) | Self-study units on words, active voice and short sentences | 1 h 30 min |
| 5.2 | [Diátaxis](https://diataxis.fr/) | Start page and "Explanation" | 40 min |
| 5.3 | [Make a README](https://www.makeareadme.com/) | Full page | 15 min |
| 5.4 | [ASD-STE100 — official site](https://www.asd-ste100.org/) **UNVERIFIED** | Overview of the standard; request the free specification copy | 20 min |

### Study steps

| Step | Time | Do this | Checkpoint |
|---|---|---|---|
| 1 | 45 min | Do the first half of resource 5.1. | Rewrite three passive sentences from your notes in the active voice. |
| 2 | 45 min | Do the second half of resource 5.1. | Cut one paragraph of your notes to half its length. |
| 3 | 45 min | Read resources 5.2 and 5.3. | Say which Diátaxis type "How it works" is. |
| 4 | 30 min | Read resource 5.4. Make an outline: one heading for each pipeline stage. | Each heading has one sentence that a new reader understands. |

### Check yourself

1. Can you explain each stage of the landing pipeline without a look at the code?
2. Which result in your README has a number and a run count next to it?
3. Which limitation must a reader know before they trust the 25 cm result?
4. Which parts did you build, and which parts did the agents build?

---

## School connection

| Concept in this lab | Typical course | Why it matters here |
|---|---|---|
| Vectors, matrices, change of basis | Linear algebra | Each frame conversion (camera → body → NED) is a matrix product. |
| Rotation matrices, Euler angles | Linear algebra; robotics (kinematics) | Attitude turns the camera view. A sign or order error moves the pad estimate. |
| Pinhole model, intrinsics, PnP | Computer vision | The tag pose in M2 comes from projection geometry. |
| Distortion and calibration | Computer vision | A wrong `K` gives a wrong distance to the pad. |
| Dynamics, rate of change | Differential equations | Vertical speed and descent profile come from the model of motion. |
| Feedback, PID, delay | Control systems | ArduPilot corrects position error. Delay in your estimate makes the landing worse. |
| Kalman filter, noise | Probability; control systems (estimation) | ArduPilot filters your target estimates. Noise and latency change its output. |
| Binomial rate, confidence intervals | Probability and statistics | "8 of 10" is a sample. The interval says how sure the M3 result is. |
| Seeds, experiment design | Probability and statistics; research methods | Fixed seeds make M4 results repeatable and fair. |
| Message protocols, timeouts | Embedded systems; computer networks | MAVLink packets can be late or lost. Your mission must handle that. |
| State machines | Embedded systems; discrete math | `mission.py` and abort logic are state machines with guarded transitions. |
| Safety cases, fail-safe design | Embedded/robotics; aerospace systems | Abort and go-around are the safe response when a check fails. |

Free full courses for these areas: [MIT 18.06 Linear Algebra](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/),
[MIT 18.05 Probability and Statistics](https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/),
[MIT 16.30 Feedback Control](https://ocw.mit.edu/courses/16-30-feedback-control-systems-fall-2010/),
[First Principles of Computer Vision](https://fpcv.cs.columbia.edu/) and
[Modern Robotics](https://hades.mech.northwestern.edu/index.php/Modern_Robotics).

---

## Stretch — after M5

These items are on the post-M5 roadmap. Nothing is built now.
Each item becomes a milestone only by a new decision in `docs/decisions.md`.

### VTOL aircraft (ArduPilot QuadPlane)

A QuadPlane takes off and lands like a copter and cruises like an airplane.
It adds transitions between the two flight types.

| Resource | Time |
|---|---|
| [ArduPilot — QuadPlane support](https://ardupilot.org/plane/docs/quadplane-support.html) | 40 min |
| [ArduPilot — Flying a QuadPlane](https://ardupilot.org/plane/docs/quadplane-flying.html) | 30 min |

Question to think about: which parts of your M3 landing pipeline change for a QuadPlane, and which stay the same?

### Simulated ADS-B traffic and avoidance

ADS-B aircraft broadcast their position. A vertiport must keep its approach path clear of other traffic.

| Resource | Time |
|---|---|
| [ArduPilot — ADS-B receiver](https://ardupilot.org/copter/docs/common-ads-b-receiver.html) | 30 min |
| [MAVLink — `ADSB_VEHICLE` message](https://mavlink.io/en/messages/common.html#ADSB_VEHICLE) | 15 min |
| [ArduPilot — Simple object avoidance](https://ardupilot.org/copter/docs/common-simple-object-avoidance.html) | 30 min |
| [OpenSky Network](https://opensky-network.org/) (real traffic data for replay) | 30 min |
| [NASA — Advanced Air Mobility](https://www.nasa.gov/mission/aam/) (context) | 20 min |

Question to think about: when is "hold and wait" safer than a go-around if traffic is near?

### Learned perception

A neural network can find a pad without a tag. Start this only after the AprilTag baseline works (charter non-goal).

| Resource | Time |
|---|---|
| [MIT 6.S191 Introduction to Deep Learning](https://introtodeeplearning.com/) | lectures 1–3, 3 h |
| [fast.ai — Practical Deep Learning for Coders](https://course.fast.ai/) | lessons 1–2, 3 h |
| [Stanford CS231n course notes](https://cs231n.github.io/) | "Image classification" and "CNNs" notes, 2 h |

Question to think about: how do you compare a learned detector with the AprilTag baseline in a fair way?
