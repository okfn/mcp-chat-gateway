"""
Logging setup using Python's built-in logging module.

Log levels:
  - DEBUG:   verbose output, dicts are pretty-printed as JSON
  - INFO:    normal operation logs (default)
  - WARNING: only warnings and errors
"""

import json
import logging
import os

import settings

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "debug")
LOG_FILE = os.path.join(LOG_DIR, "webchat.log")


class Formatter(logging.Formatter):
    """Logging formatter that pretty-prints dicts as JSON."""

    def format(self, record):
        if isinstance(record.msg, dict):
            record.msg = "\n" + json.dumps(record.msg, indent=4, ensure_ascii=False, default=str)
        return super().format(record)


def setup_logging():
    """Configure logging with console + file handlers."""
    level = getattr(logging, settings.LOG_LEVEL, logging.INFO)

    logger = logging.getLogger("webchat")
    logger.setLevel(level)

    if logger.handlers:
        return logger

    formatter = Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    logger.addHandler(console)

    os.makedirs(LOG_DIR, exist_ok=True)
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


logger = setup_logging()
