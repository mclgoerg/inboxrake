"""Rule recipes (frontend/src/recipes.json): the engine must accept every one.

The UI turns a recipe into the body of an ordinary `POST /api/rules`; a
recipe the engine refuses would show a card whose Add fails, so each filter
and each definition is validated here against the real rules code."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import mailops
from backend import rules as rulesmod
from backend.main import app

client = TestClient(app)

RECIPES = json.loads((Path(__file__).resolve().parent.parent / "frontend"
                      / "src" / "recipes.json").read_text())
GROUPS = {"tidy", "short", "protect"}


def body(r: dict, dest: str = "") -> dict:
    """What `recipeBody` (recipes.ts) sends."""
    return {"name": r["id"], "scope": "mail", "grouping": "sender",
            "query": r["query"], "action": r["action"], "dest": dest,
            "schedule": r["schedule"],
            "keep_latest": r.get("keep_latest"),
            "older_than_days": r.get("older_than_days")}


def test_nine_recipes_with_unique_ids():
    assert len(RECIPES) == 9
    assert len({r["id"] for r in RECIPES}) == 9
    assert {r["group"] for r in RECIPES} <= GROUPS


@pytest.mark.parametrize("r", RECIPES, ids=[r["id"] for r in RECIPES])
def test_every_recipe_filter_is_valid(r):
    assert rulesmod.validate_filter(r["query"]) == []
    assert len(r["query"]) <= rulesmod.FILTER_MAX


@pytest.mark.parametrize("r", RECIPES, ids=[r["id"] for r in RECIPES])
def test_every_recipe_creates_a_report_mode_rule(r):
    assert r["action"] in mailops.ACTIONS
    assert r["schedule"] in rulesmod.SCHEDULES
    # keep-latest and older-than never together; at most one of them
    assert not (r.get("keep_latest") and r.get("older_than_days"))
    dest = "Receipts" if r["action"] == "move" else ""
    rule = rulesmod.create_rule(body(r, dest))
    assert rule["mode"] == "report"          # a recipe never starts armed
    assert rule["report_runs"] == 0
    assert rule["query"] == r["query"]
    assert rule["action"] == r["action"]
    assert rule["keep_latest"] == r.get("keep_latest")
    assert rule["older_than_days"] == r.get("older_than_days")


def test_a_recipe_cannot_start_armed_even_if_the_body_asks():
    r = RECIPES[0]
    rule = rulesmod.create_rule({**body(r), "mode": "execute"})
    assert rule["mode"] == "report"


def test_a_filing_recipe_needs_its_folder():
    r = next(x for x in RECIPES if x["action"] == "move")
    with pytest.raises(ValueError, match="target folder"):
        rulesmod.create_rule(body(r, ""))


def test_recipes_through_the_api():
    r = RECIPES[1]
    res = client.post("/api/rules", json=body(r))
    assert res.status_code == 200, res.text
    assert res.json()["mode"] == "report"
    assert any(x["query"] == r["query"] for x in client.get("/api/rules")
               .json()["rules"])


def test_no_recipe_names_a_company():
    # generic words only (CONTRIBUTING "Privacy"): qualifiers, no free text
    for r in RECIPES:
        assert rulesmod.parse_filter(r["query"])["text"] == []
