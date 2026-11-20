"""Run an Odoo test command under a Linux subreaper in a container whose PID 1 does not reap."""
import ctypes
import os
import subprocess
import sys
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
    raise OSError(ctypes.get_errno(), 'prctl(PR_SET_CHILD_SUBREAPER)')
child = subprocess.Popen(sys.argv[1:])
while True:
    pid, status = os.wait()
    if pid == child.pid:
        child.returncode = os.waitstatus_to_exitcode(status)
        sys.exit(child.returncode)
