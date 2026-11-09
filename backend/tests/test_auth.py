from tests.conftest import hdr


async def test_register_login_me_refresh(client):
    r = await client.post(
        "/api/v1/auth/register", json={"email": "Grace@Example.com", "password": "hopper-1906", "name": "Grace Hopper"}
    )
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["email"] == "grace@example.com"
    assert body["workspaces"][0]["name"] == "Grace's workspace"
    assert "nexus_refresh" in r.cookies

    # duplicate email
    r2 = await client.post("/api/v1/auth/register", json={"email": "grace@example.com", "password": "x" * 10, "name": "G"})
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "email_taken"

    # wrong password
    bad = await client.post("/api/v1/auth/login", json={"email": "grace@example.com", "password": "wrong-pass"})
    assert bad.status_code == 401

    ok = await client.post("/api/v1/auth/login", json={"email": "grace@example.com", "password": "hopper-1906"})
    assert ok.status_code == 200
    token = ok.json()["access_token"]

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["user"]["name"] == "Grace Hopper"

    # refresh rotates the cookie; the old refresh token is single-use
    old = client.cookies.get("nexus_refresh")
    ref = await client.post("/api/v1/auth/refresh")
    assert ref.status_code == 200
    assert client.cookies.get("nexus_refresh") != old
    client.cookies.set("nexus_refresh", old, path="/api/v1/auth")
    reuse = await client.post("/api/v1/auth/refresh")
    assert reuse.status_code == 401


async def test_protected_routes_require_auth(client):
    assert (await client.get("/api/v1/workflows")).status_code == 401
    assert (await client.get("/api/v1/workflows", headers={"Authorization": "Bearer nope"})).status_code == 401


async def test_workspace_isolation(client, auth):
    other = await client.post(
        "/api/v1/auth/register", json={"email": "eve@example.com", "password": "eve-password", "name": "Eve"}
    )
    eve_ws = other.json()["workspaces"][0]["id"]
    r = await client.get("/api/v1/workflows", headers={**hdr(auth), "X-Workspace-Id": eve_ws})
    assert r.status_code == 403


async def test_input_validation(client):
    r = await client.post("/api/v1/auth/register", json={"email": "not-an-email", "password": "short", "name": ""})
    assert r.status_code == 422
