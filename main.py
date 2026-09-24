#!/usr/bin/env python3
"""Compatibility entry point for the standalone audiobook workflow."""
import signal
from app.engine import main

def interrupted(signum, frame):
    raise KeyboardInterrupt('Interrupted by signal {}'.format(signum))

if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    raise SystemExit(main())
