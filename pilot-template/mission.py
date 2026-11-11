"""M1 mission. Collin owns this file. Nobody else writes it.

The platform runner calls run(ap, budgets). Read START-HERE.md first.
Each state has one function. Each function has a question.
The answer to each question is your design. Write it yourself.

Run the tests for one step:   ./learn step 1
"""
from lab import mavlite  # names for MAVLink numbers: commands, modes and flag bits

PLATFORM_INTERFACE = 1  # Do not change this line. `./learn doctor` checks it.


def run(ap, budgets):
    """Fly the M1 mission. This function is yours to design.

    `ap` sends commands and gives decoded messages. `budgets` holds one time limit
    in seconds for each wait (budgets.connect_s, budgets.ready_s and so on).
    The mission has nine states, below. Each state function has its own question.
    Call ap.succeed() or ap.fail(code, detail) to report the result.
    Start run() in step 1 with the two states of step 1. Add the next states in each step.

    Question: In which order do you enter the states? What do you do when one state fails?
    Question: What must be true before you leave one state and enter the next?
    """
    raise NotImplementedError("STEP 1: write run()")


def connect(ap, budgets) -> bool:
    """STEP 1. State CONNECT. Call ap.phase("CONNECT") first.

    Question: Which message shows that the autopilot is alive?
    Question: What do you do when it does not arrive in budgets.connect_s seconds?
    """
    raise NotImplementedError("STEP 1: write connect()")


def wait_ready(ap, budgets) -> bool:
    """STEP 1. State WAIT_READY. Call ap.phase("WAIT_READY") first.

    Question: What proves that the autopilot will accept an arm command now?
    Question: Does a STANDBY heartbeat prove it? Watch the [text] lines to check.
    Time limit: budgets.ready_s.
    """
    raise NotImplementedError("STEP 1: write wait_ready()")


def set_guided(ap, budgets) -> bool:
    """STEP 2. State SET_GUIDED. Call ap.phase("SET_GUIDED") first.

    Question: You request a mode. Which later message confirms the mode?
    Time limit: budgets.guided_s.
    """
    raise NotImplementedError("STEP 2: write set_guided()")


def arm(ap, budgets) -> bool:
    """STEP 2. State ARM. Call ap.phase("ARM") first.

    Question: The autopilot sends an ACK. Does the ACK prove that the motors are armed?
    Question: What does a refused arm look like in the [ack] and [text] lines?
    Time limit: budgets.arm_s.
    """
    raise NotImplementedError("STEP 2: write arm()")


def takeoff(ap, budgets) -> bool:
    """STEP 3. State TAKEOFF. Call ap.phase("TAKEOFF") first. Request a height of 5 m.

    Question: Which ACK result do you accept? What do you do with any other result?
    """
    raise NotImplementedError("STEP 3: write takeoff()")


def climb(ap, budgets) -> bool:
    """STEP 3. State CLIMB. Call ap.phase("CLIMB") first.

    Question: Which message and field give the height above the home point? In which unit?
    Question: Why is a band (at least 4.75 m) better than exactly 5.0 m?
    Time limit: budgets.climb_s.
    """
    raise NotImplementedError("STEP 3: write climb()")


def hold(ap, budgets) -> bool:
    """STEP 3. State HOLD. Call ap.phase("HOLD") first. Stay at height for budgets.hold_s seconds.

    Question: Which clock do you use to measure the time?
    Question: What do you check while you wait? What do you do if the telemetry stops?
    """
    raise NotImplementedError("STEP 3: write hold()")


def land(ap, budgets) -> bool:
    """STEP 4. State LAND. Call ap.phase("LAND") first. Request a landing.

    Question: There are two ways to request a landing. Which one do you choose? Why?
    """
    raise NotImplementedError("STEP 4: write land()")


def wait_disarm(ap, budgets) -> bool:
    """STEP 4. State WAIT_DISARM. Call ap.phase("WAIT_DISARM") first.

    Question: Which message shows that the motors are off? Do not send a disarm command.
    Time limit: budgets.disarm_s.
    """
    raise NotImplementedError("STEP 4: write wait_disarm()")
