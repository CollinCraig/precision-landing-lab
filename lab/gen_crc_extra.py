# Generator for lab/mavlink_crc_extra.py. Needs pymavlink (container venv ~/venv-ardupilot).
from pymavlink.dialects.v20 import ardupilotmega as m
import pymavlink
print('"""CRC_EXTRA byte of every MAVLink message in the ardupilotmega dialect.')
print()
print("Generated, not hand-written. Source: pymavlink %s, dialect v20/ardupilotmega" % pymavlink.__version__)
print("(the \"all\" dialect that ArduPilot builds use; MAVProxy 1.8.75 pulls this pymavlink).")
print("Generator command (run in the landing-lab container venv):")
print("    python3 lab/gen_crc_extra.py > lab/mavlink_crc_extra.py")
print("`export_tlog` checks the CRC of every frame with this table. A msgid that is not")
print('in the table is not a valid frame of this dialect.')
print('"""')
print()
print("PYMAVLINK_VERSION = %r" % pymavlink.__version__)
print("CRC_EXTRA = {")
for i in sorted(m.mavlink_map):
    c = m.mavlink_map[i]
    print("    %d: %d,  # %s" % (i, c.crc_extra, c.msgname))
print("}")
