# Primer 00 — What are SITL and MAVLink?

~10 minutes. Prepares you for your M1 piece: `mission.py`.

## The autopilot: ArduPilot

A real drone has a small computer called a **flight controller** running
autopilot software. We use **ArduPilot** (the *Copter* version). It reads
sensors (gyros, accelerometers, GPS, barometer), keeps the aircraft stable and
follows commands like "take off to 5 m" or "land here."

ArduPilot is the pilot. **Your code never spins motors.** Your code is more
like air traffic control: it tells the pilot what to do and watches what happens.

## SITL: the autopilot without the aircraft

**SITL** (Software In The Loop) runs the *same* ArduPilot code on your laptop.
The real sensors and motors are swapped for a physics model:

```
ArduPilot (real code) ── motor commands ──▶ physics model
          ▲                                     │
          └──────── fake sensor readings ◀──────┘
```

- **M1:** ArduPilot's built-in simple physics. Fast, no 3D world.
- **M2+:** **Gazebo** is the physics model, which adds a 3D world and a camera.

Your script can't tell the difference, so code written in M1 keeps working in M2.

## MAVLink: how your code talks to the autopilot

**MAVLink** is the message language between ArduPilot and anything else
(ground stations, scripts). Messages are small, typed packets. A few you'll meet:

| Message | Direction | Meaning |
|---|---|---|
| `HEARTBEAT` | both ways, ~1/s | "I'm alive." Also carries the mode and whether the motors are armed. |
| `COMMAND_LONG` | you → autopilot | A command, e.g. arm, or take off to N m. |
| `COMMAND_ACK` | autopilot → you | "Accepted" or "refused" for a command. |
| `GLOBAL_POSITION_INT` | autopilot → you | Position, incl. height above home (in **millimetres**). |
| `STATUSTEXT` | autopilot → you | Human-readable messages, e.g. why arming failed. |
| `LANDING_TARGET` | you → autopilot | (M3) "The pad is over there." |

In Python we use **pymavlink**. The connection is plumbing that agents provide.
It looks roughly like this:

```python
from pymavlink import mavutil
link = mavutil.mavlink_connection("tcp:127.0.0.1:5760")
link.wait_heartbeat()
msg = link.recv_match(type="GLOBAL_POSITION_INT", blocking=True, timeout=1)
```

## Modes and arming

- **Flight mode** sets who's in charge. **GUIDED** means "accept commands
  from a script." **LAND** means "descend and land here."
- **Arming** turns the motors on. ArduPilot refuses to arm until its
  **pre-arm checks** pass (e.g. the GPS has a fix and the position estimate is
  healthy). In SITL that can take a few seconds after start. Wait for it; don't fight it.

## Frames: which way is "up"?

ArduPilot's local frame is **NED**: x = North, y = East, z = **Down**.
So 5 m *above* home is **z = −5**. Most first bugs are sign errors here.
(`GLOBAL_POSITION_INT.relative_alt` is the friendlier one: positive up, in mm.)

## Your M1 mission is a state machine

```
CONNECT → WAIT_READY → SET_GUIDED → ARM → TAKEOFF → CLIMB → HOLD(5 s)
        → LAND → WAIT_DISARM → DONE
(any step that takes too long → FAIL with a reason)
```

Three rules that make it robust:
1. **Commands are requests, not facts.** After sending one, confirm the
   result from the autopilot's state (mode, armed flag, altitude), not just the ACK.
2. **Every wait has a timeout** and a clear failure reason.
3. **Use thresholds, not exact values.** "Reached 5 m" means about ≥ 4.75 m,
   not exactly 5.000.

## Check yourself (no code needed)

1. Why can't you just send "take off" right after connecting?
2. The drone is 3 m above home. What is its NED z?
3. You sent "arm" and got an ACK saying accepted, but HEARTBEAT still says
   disarmed a second later. What should your state machine do?
4. Why does the same `mission.py` work in M1 and M2?

Answers get discussed when M1 starts. It's fine not to know them all yet.
