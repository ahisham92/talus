"""Talus's server: the page, the per-person project store, and the engine tests."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from talus_app.app import SITE_KEY, create_app, is_public
from talus_app.store import Store

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.delenv("TALUS_DEV_ACCOUNT", raising=False)
    return create_app(Store(tmp_path))


def as_user(app, uid="u1"):
    c = app.test_client()
    c.environ_base[SITE_KEY] = {"id": uid, "name": "User " + uid, "login": uid}
    return c


def test_health_needs_no_sign_in(app):
    r = app.test_client().get("/healthz")
    assert r.status_code == 200 and r.get_json()["status"] == "ok"


def test_page_needs_the_site_sign_in(app):
    assert app.test_client().get("/").status_code == 401
    r = as_user(app).get("/")
    assert r.status_code == 200
    assert b"Talus" in r.data and b"importmap" in r.data


def test_only_static_files_are_public():
    assert is_public("/static/talus.css")
    assert not is_public("/api/projects")
    assert not is_public("/")


def test_project_round_trip_and_history(app):
    c = as_user(app)
    r = c.post("/api/projects", json={"data": {"type": "cut", "name": "A"}})
    assert r.status_code == 201
    p = r.get_json()
    assert p["version"] == 1 and p["data"]["name"] == "A"
    r = c.put(f"/api/projects/{p['id']}", json={"data": {"type": "cut", "name": "B"}, "base_version": 1})
    assert r.get_json()["version"] == 2
    # a stale save is refused with the current copy, unless forced
    r = c.put(f"/api/projects/{p['id']}", json={"data": {"type": "cut", "name": "C"}, "base_version": 1})
    assert r.status_code == 409 and r.get_json()["current"]["data"]["name"] == "B"
    assert c.get("/api/projects").get_json()["projects"][0]["name"] == "B"
    versions = c.get(f"/api/projects/{p['id']}/versions").get_json()["versions"]
    assert len(versions) == 1
    r = c.post(f"/api/projects/{p['id']}/versions/{versions[0]['id']}/restore")
    assert r.get_json()["data"]["name"] == "A"
    dup = c.post(f"/api/projects/{p['id']}/duplicate").get_json()
    assert dup["name"] == "A (copy)"
    assert c.delete(f"/api/projects/{p['id']}").status_code == 200
    assert c.get(f"/api/projects/{p['id']}").status_code == 404


def test_people_see_only_their_own_projects(app):
    a, b = as_user(app, "a"), as_user(app, "b")
    pid = a.post("/api/projects", json={"data": {"type": "embankment", "name": "Mine"}}).get_json()["id"]
    assert b.get(f"/api/projects/{pid}").status_code == 404
    assert b.put(f"/api/projects/{pid}", json={"data": {"type": "cut"}}).status_code == 404
    assert b.delete(f"/api/projects/{pid}").status_code == 404
    assert b.get("/api/projects").get_json()["projects"] == []


def test_bad_projects_are_refused(app):
    c = as_user(app)
    assert c.post("/api/projects", json={"data": {"type": "volcano"}}).status_code == 400
    assert c.post("/api/projects", json={"data": "nope"}).status_code == 400
    assert c.post("/api/projects", data="x", content_type="text/plain").status_code == 415
    assert app.test_client().get("/api/projects").status_code == 401


def test_engine_files_are_served_as_modules(app):
    c = as_user(app)
    for path in ("/static/engine/lem.js", "/static/js/app.js", "/static/js/worker.js", "/static/vendor/three/three.module.min.js"):
        r = c.get(path)
        assert r.status_code == 200, path
        assert "javascript" in r.headers["Content-Type"], path


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_engine_verification_and_behaviour():
    """The calculation engine's own tests (closed forms, benchmarks, behaviour)."""
    r = subprocess.run(["node", "--test", str(ROOT / "tests" / "engine.test.mjs")], cwd=ROOT,
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stdout[-4000:] + r.stderr[-2000:]
