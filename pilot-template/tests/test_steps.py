"""Step tests. They run the platform's step-tagged tests against this folder.

Run all steps:      python -m unittest -v tests.test_steps
Run one step:       ./learn step 1
Each test class is one step. The empty starter code fails them all. Expect this.
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
platform = os.environ.get("LANDING_LAB_PLATFORM") or (HERE / ".platform-path").read_text().strip()
sys.path[:0] = [platform, str(Path(platform) / "tests")]
os.environ["M1_PILOT"] = str(HERE)
os.environ.setdefault("M1_LAST_RUN_DIR", str(HERE / "local" / "last-run"))

from test_pilot_steps import Step1Tests, Step2Tests, Step3Tests, Step4Tests  # noqa: E402,F401
