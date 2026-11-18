"""Paths and runtime configuration.

The hackathon data is proprietary and must live OUTSIDE this repository.
``STL_DATA_DIR`` points at a local clone of the data repo; every derived artefact
is written under ``MACRODNA_CACHE_DIR`` (default ``private/cache``, which is gitignored).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = REPO_ROOT.parent / "stl-hackathon-2026-grid-starter"
DEFAULT_CACHE_DIR = REPO_ROOT / "private" / "cache"


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    cache_dir: Path

    @property
    def lol_dir(self) -> Path:
        return self.data_dir / "lol"

    @property
    def meta_dir(self) -> Path:
        return self.data_dir / "meta"

    def validate(self) -> None:
        if not self.lol_dir.is_dir() or not self.meta_dir.is_dir():
            raise FileNotFoundError(
                f"GRID data not found at {self.data_dir}. Clone the data repo next to this "
                "project (never inside it) and set STL_DATA_DIR."
            )
        _refuse_data_inside_repo(self.data_dir)
        _refuse_cache_outside_private(self.cache_dir)


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def _refuse_data_inside_repo(data_dir: Path) -> None:
    if _is_within(data_dir, REPO_ROOT):
        raise RuntimeError(
            "STL_DATA_DIR is inside the project repository. The data license forbids committing "
            "it, so keep the data repo outside this project."
        )


def _refuse_cache_outside_private(cache_dir: Path) -> None:
    """Derived data must never land somewhere git could pick it up."""
    private = REPO_ROOT / "private"
    if _is_within(cache_dir, REPO_ROOT) and not _is_within(cache_dir, private):
        raise RuntimeError(
            f"Cache dir {cache_dir} is inside the repo but outside the gitignored private/ folder."
        )


def load_settings() -> Settings:
    data_dir = Path(os.environ.get("STL_DATA_DIR", DEFAULT_DATA_DIR)).expanduser()
    cache_dir = Path(os.environ.get("MACRODNA_CACHE_DIR", DEFAULT_CACHE_DIR)).expanduser()
    return Settings(data_dir=data_dir, cache_dir=cache_dir)
