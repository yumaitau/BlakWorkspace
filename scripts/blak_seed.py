"""Idempotent GitHub seed planner and applier.

Dry-run never writes seed-map.json. Apply records only real issue numbers
returned by GitHub (or a test double). Does not assign people or change
repository visibility.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from blak_backlog import (
    extract_markers,
    load_json,
    load_manifest,
    repo_root,
    seed_map_path,
    validate_tree,
)


@dataclass
class RemoteIssue:
    number: int
    title: str
    body: str
    labels: list[str] = field(default_factory=list)
    milestone: str | None = None
    assignees: list[str] = field(default_factory=list)


class GitHubClient(Protocol):
    def list_issues(self) -> list[RemoteIssue]: ...

    def create_issue(
        self,
        *,
        title: str,
        body: str,
        labels: list[str],
        milestone: str | None = None,
    ) -> RemoteIssue: ...

    def ensure_milestone(self, title: str) -> str: ...


@dataclass
class MemoryGitHub:
    """In-memory GitHub double for tests. Never invents numbers: sequential from seed."""

    issues: list[RemoteIssue] = field(default_factory=list)
    milestones: list[str] = field(default_factory=list)
    next_number: int = 1
    created: list[RemoteIssue] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.issues:
            self.next_number = max(i.number for i in self.issues) + 1

    def list_issues(self) -> list[RemoteIssue]:
        return list(self.issues)

    def ensure_milestone(self, title: str) -> str:
        if title not in self.milestones:
            self.milestones.append(title)
        return title

    def create_issue(
        self,
        *,
        title: str,
        body: str,
        labels: list[str],
        milestone: str | None = None,
    ) -> RemoteIssue:
        issue = RemoteIssue(
            number=self.next_number,
            title=title,
            body=body,
            labels=list(labels),
            milestone=milestone,
            assignees=[],
        )
        self.next_number += 1
        self.issues.append(issue)
        self.created.append(issue)
        return issue


@dataclass
class PlannedCreate:
    item: dict
    title: str
    body: str
    labels: list[str]
    milestone: str | None


@dataclass
class SeedPlan:
    creates: list[PlannedCreate]
    skips: list[tuple[str, int, str]]  # id, existing number, reason


def load_seed_map(path: Path) -> dict:
    if not path.is_file():
        return {"issues": {}}
    data = load_json(path)
    issues = data.get("issues") if isinstance(data, dict) else None
    if not isinstance(issues, dict):
        return {"issues": {}}
    return {"issues": issues}


def write_seed_map(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def remote_markers(remote: list[RemoteIssue]) -> dict[str, int]:
    found: dict[str, int] = {}
    for issue in remote:
        for marker in extract_markers(issue.body or ""):
            found.setdefault(marker, issue.number)
    return found


def issues_for_epic(data: dict, epic_id: str | None) -> list[dict]:
    issues = list(data["issues"])
    if not epic_id:
        return issues
    by_id = {item["id"]: item for item in issues}
    if epic_id not in by_id:
        raise ValueError(f"unknown epic {epic_id}")
    allow = {epic_id, *(by_id[epic_id].get("children") or [])}
    return [item for item in issues if item["id"] in allow]


def plan_seed(
    data: dict,
    root: Path,
    remote: list[RemoteIssue],
    epic_id: str | None = None,
) -> SeedPlan:
    markers = remote_markers(remote)
    creates: list[PlannedCreate] = []
    skips: list[tuple[str, int, str]] = []
    for item in issues_for_epic(data, epic_id):
        iid = item["id"]
        if iid in markers:
            skips.append((iid, markers[iid], "marker present"))
            continue
        body = (root / item["body_path"]).read_text(encoding="utf-8")
        title = item["title"] if item["title"].startswith("[") else f"[{iid}] {item['title']}"
        creates.append(
            PlannedCreate(
                item=item,
                title=title,
                body=body,
                labels=list(item.get("labels") or []),
                milestone=item.get("milestone"),
            )
        )
    return SeedPlan(creates=creates, skips=skips)


def format_plan(plan: SeedPlan, *, dry_run: bool) -> str:
    kind = "DRY-RUN" if dry_run else "APPLY"
    lines = [f"{kind}: planned creates: {len(plan.creates)}"]
    for item in plan.creates:
        lines.append(f"  CREATE {item.item['id']}: {item.title}")
    for iid, number, reason in plan.skips:
        lines.append(f"  SKIP {iid}: {reason} on #{number}")
    if dry_run:
        lines.append("seed-map not written (dry-run)")
    return "\n".join(lines)


def apply_seed(
    plan: SeedPlan,
    client: GitHubClient,
    map_path: Path,
    existing_map: dict | None = None,
) -> dict:
    """Create only missing issues. Write real numbers into seed-map."""
    seed_map = existing_map or load_seed_map(map_path)
    issues = dict(seed_map.get("issues") or {})
    for iid, number, _reason in plan.skips:
        issues[iid] = number
    for planned in plan.creates:
        if planned.milestone:
            client.ensure_milestone(planned.milestone)
        created = client.create_issue(
            title=planned.title,
            body=planned.body,
            labels=planned.labels,
            milestone=planned.milestone,
        )
        if created.assignees:
            raise RuntimeError("seed must not assign people")
        issues[planned.item["id"]] = created.number
    result = {"issues": issues}
    write_seed_map(map_path, result)
    return result


class GhCliGitHub:
    """GitHub client via `gh api`. Used only on --apply against a real repo."""

    def __init__(self, owner: str, repo: str) -> None:
        self.owner = owner
        self.repo = repo
        self._milestones: dict[str, int] | None = None

    def _api(self, method: str, path: str, payload: dict | None = None) -> object:
        import subprocess

        cmd = ["gh", "api", "-X", method, path]
        if payload is not None:
            cmd.extend(["--input", "-"])
        proc = subprocess.run(
            cmd,
            input=json.dumps(payload) if payload is not None else None,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
        if not proc.stdout.strip():
            return {}
        return json.loads(proc.stdout)

    def list_issues(self) -> list[RemoteIssue]:
        import subprocess

        path = f"repos/{self.owner}/{self.repo}/issues?state=all&per_page=100"
        proc = subprocess.run(
            ["gh", "api", "--paginate", path],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
        raw = json.loads(proc.stdout) if proc.stdout.strip() else []
        issues: list[RemoteIssue] = []
        for item in raw:
            if item.get("pull_request"):
                continue
            labels = [lab["name"] for lab in item.get("labels") or []]
            milestone = None
            if item.get("milestone"):
                milestone = item["milestone"].get("title")
            issues.append(
                RemoteIssue(
                    number=item["number"],
                    title=item.get("title") or "",
                    body=item.get("body") or "",
                    labels=labels,
                    milestone=milestone,
                    assignees=[a.get("login") for a in item.get("assignees") or []],
                )
            )
        return issues

    def ensure_milestone(self, title: str) -> str:
        if self._milestones is None:
            raw = self._api("GET", f"repos/{self.owner}/{self.repo}/milestones?state=all")
            self._milestones = {m["title"]: m["number"] for m in raw}  # type: ignore[union-attr]
        if title not in self._milestones:
            created = self._api(
                "POST",
                f"repos/{self.owner}/{self.repo}/milestones",
                {"title": title},
            )
            self._milestones[title] = created["number"]  # type: ignore[index]
        return title

    def create_issue(
        self,
        *,
        title: str,
        body: str,
        labels: list[str],
        milestone: str | None = None,
    ) -> RemoteIssue:
        payload: dict = {"title": title, "body": body, "labels": labels}
        if milestone:
            if self._milestones is None:
                self.ensure_milestone(milestone)
            payload["milestone"] = self._milestones[milestone]  # type: ignore[index]
        created = self._api(
            "POST",
            f"repos/{self.owner}/{self.repo}/issues",
            payload,
        )
        return RemoteIssue(
            number=created["number"],  # type: ignore[index]
            title=created.get("title") or title,  # type: ignore[union-attr]
            body=created.get("body") or body,  # type: ignore[union-attr]
            labels=labels,
            milestone=milestone,
            assignees=[],
        )


def run_seed(
    *,
    root: Path,
    dry_run: bool,
    client: GitHubClient | None = None,
    remote: list[RemoteIssue] | None = None,
    epic_id: str | None = None,
) -> tuple[int, str, dict | None]:
    errors = validate_tree(root)
    if errors:
        return 1, "\n".join(f"ERROR: {e}" for e in errors), None
    data = load_manifest(root)
    if remote is None:
        if client is None:
            owner_repo = data.get("repo") or "yumaitau/BlakWorkspace"
            owner, repo = owner_repo.split("/", 1)
            client = GhCliGitHub(owner, repo)
        remote = client.list_issues()
    plan = plan_seed(data, root, remote, epic_id=epic_id)
    text = format_plan(plan, dry_run=dry_run)
    if dry_run:
        return 0, text, None
    if client is None:
        raise RuntimeError("apply requires a GitHub client")
    seed_map = apply_seed(plan, client, seed_map_path(root))
    created_n = len(plan.creates)
    text += f"\nseed-map written with {len(seed_map['issues'])} real numbers ({created_n} created)"
    return 0, text, seed_map


def main_seed(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed GitHub issues from the backlog manifest")
    parser.add_argument("--dry-run", action="store_true", help="print planned creates; do not write")
    parser.add_argument("--apply", action="store_true", help="create missing issues and write seed-map")
    parser.add_argument("--epic", help="limit seed to this epic id and its children")
    args = parser.parse_args(argv)
    if args.apply and args.dry_run:
        print("ERROR: choose either --dry-run or --apply", file=sys.stderr)
        return 2
    dry_run = not args.apply
    root = repo_root()
    code, text, _seed_map = run_seed(root=root, dry_run=dry_run, epic_id=args.epic)
    stream = sys.stderr if code else sys.stdout
    print(text, file=stream)
    return code


if __name__ == "__main__":
    raise SystemExit(main_seed())
