"""Repo-root helpers for tests that drive shipped files."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def exists(rel: str) -> bool:
    return (ROOT / rel).is_file()
