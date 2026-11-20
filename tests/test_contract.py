"""Keep the web app's types in step with the API schemas.

``web/src/api/types.ts`` mirrors ``src/macrodna/api/schemas.py`` by hand. This test fails as soon as a field
is added, removed, renamed or made nullable on one side only, so a contract drift shows up in CI rather
than as a blank panel in the demo.
"""

from __future__ import annotations

import re
import typing
from pathlib import Path

import pytest
from pydantic import BaseModel

from macrodna.api import schemas

TYPES_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "api" / "types.ts"

MODELS = {
    name: obj
    for name, obj in vars(schemas).items()
    if isinstance(obj, type) and issubclass(obj, BaseModel) and obj is not BaseModel
}


def _interfaces(source: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for name, body in re.findall(r"export interface (\w+)[^{]*\{(.*?)^\}", source, re.S | re.M):
        out[name] = {
            m.group(1): m.group(3).strip()
            for m in re.finditer(r"^\s+(\w+)(\??):\s*(.+?);\s*(?://.*)?$", body, re.M)
        }
    return out


def _aliases(source: str) -> dict[str, set[str]]:
    return {
        name: set(re.findall(r'"([^"]+)"', value))
        for name, value in re.findall(r"export type (\w+) =\s*((?:\s*\|?\s*\"[^\"]+\")+);", source)
    }


def _nullable(annotation: object) -> bool:
    """True if ``None`` appears anywhere in the annotation (``int | None``, ``dict[str, int | None]``)."""
    return annotation is type(None) or any(_nullable(a) for a in typing.get_args(annotation))


TS = TYPES_TS.read_text(encoding="utf-8")
INTERFACES = _interfaces(TS)


def test_the_parser_found_the_interfaces() -> None:
    assert len(INTERFACES) > 30 and "Replay" in INTERFACES and INTERFACES["Rate"]["n"] == "number"


@pytest.mark.parametrize("name", sorted(MODELS))
def test_every_schema_has_a_matching_typescript_interface(name: str) -> None:
    assert name in INTERFACES, f"{name} is in schemas.py but not in web/src/api/types.ts"
    fields = MODELS[name].model_fields
    ts_fields = INTERFACES[name]
    assert set(fields) == set(ts_fields), (
        f"{name}: only in schemas.py {sorted(set(fields) - set(ts_fields))}, "
        f"only in types.ts {sorted(set(ts_fields) - set(fields))}"
    )
    for field, info in fields.items():
        assert _nullable(info.annotation) == ("null" in ts_fields[field]), (
            f"{name}.{field}: nullability differs (schemas: {info.annotation}, types.ts: {ts_fields[field]})"
        )


@pytest.mark.parametrize("alias", ["Side", "Strength", "Role"])
def test_shared_literals_agree(alias: str) -> None:
    py = {a for a in typing.get_args(getattr(schemas, alias))}
    assert py == _aliases(TS)[alias]


def test_pool_status_values_agree() -> None:
    field = schemas.RolePool.model_fields["status"].annotation
    assert set(typing.get_args(field)) == _aliases(TS)["PoolStatus"]
