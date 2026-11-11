# Primer 01: a mission is a state machine

Read this page once, in about 10 minutes. It gives the ideas for M1. It gives no code.

## The picture

Your code is a pilot who cannot see the aircraft. The pilot only reads messages.
The autopilot flies the aircraft. Your code asks. The autopilot answers.
The answer is not the same as the result.

## Idea 1: a request is not a state

Your code sends a request, for example "arm". The autopilot sends a COMMAND_ACK.
The ACK means: "I got the request" or "I refuse the request". It does not mean "the motors are on".
The state changes later. A later HEARTBEAT shows the state.

- Request: your command.
- Answer: COMMAND_ACK. Read its `result`. Result 0 is ACCEPTED. Other numbers are refusals or delays.
- Proof: a later message that shows the new state.

Your code moves to the next state only after the proof.

## Idea 2: alive is not ready

A HEARTBEAT shows that the autopilot is alive. In the first real flight, the heartbeat said STANDBY
for the first 40 seconds. In that time the autopilot refused to arm.
It needed a GPS fix and an EKF that uses the GPS. The EKF is the estimator that calculates position.
Without a position estimate, GUIDED flight is not safe. The autopilot refuses to arm.

The refusal had two visible signs:

- A COMMAND_ACK with a result that was not 0.
- A STATUSTEXT line such as `Arm: Need Position Estimate`.

Your code must find out for itself when the autopilot is ready. See `hints/step-1/`.

## Idea 3: every wait has a time limit

Telemetry can stop. A command can be refused. A state can never arrive.
If your code waits with no limit, it waits for ever.
Give each wait its own time limit. The platform gives the limits in `budgets`.
When a limit ends, report a failure. Name the state in the failure detail.

## Idea 4: units and thresholds

`GLOBAL_POSITION_INT.relative_alt` is in millimetres. It is the height above the home point.
Do not test for exactly 5.0 m. The aircraft never stops at one exact number.
Use a band. The tests use at least 4.75 m.

## The nine states

CONNECT, WAIT_READY, SET_GUIDED, ARM, TAKEOFF, CLIMB, HOLD, LAND, WAIT_DISARM.
The platform gives this list. The design of each state is your work.

## What you see when you run

The tool prints every ACK and every STATUSTEXT to `mission.stderr`. Example lines:

    [  3.20s] [send] COMMAND_LONG 400 (1,)
    [  3.25s] [ack] COMMAND_ACK command=400 result=4 (FAILED)
    [  3.25s] [text] STATUSTEXT severity=3 text='Arm: Need Position Estimate'

Read these lines first when a test fails.

## Time

The M1 hold is measured with the wall clock. SITL runs at speed 1 in M1.
