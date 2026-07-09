"""Compatibility wrapper for the Michaels pipeline public API."""

import sys as _sys
from pathlib import Path as _Path

_PROJECT_ROOT = _Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in _sys.path:
    _sys.path.insert(0, str(_PROJECT_ROOT))

from pipelines.michaels import pipeline as _pipeline

globals().update(
    {
        name: getattr(_pipeline, name)
        for name in dir(_pipeline)
        if not name.startswith("__")
    }
)

__all__ = [name for name in globals() if not name.startswith("_")]


def __getattr__(name):
    return getattr(_pipeline, name)


def __dir__():
    return sorted(set(globals()) | set(dir(_pipeline)))


if __name__ == "__main__":
    _pipeline.main()
