"""AutoSocial AI backend test suite — pytest.

Covers: health, auth (register/login/me), business, social connections,
uploads, image generation (Gemini Nano Banana), caption generation (GPT-5.2),
posts (mocked publish), dashboard summary.
"""
import os
import io
import base64
import uuid
import pytest
import requests
from PIL import Image


def _make_jpeg_b64() -> str:
    img = Image.new("RGB", (256, 256), (200, 120, 60))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8000")
API = f"{BASE_URL}/api"

# ----- Module-scoped state -----
_session_state: dict = {}


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_headers(api_client):
    """Register a fresh user for this test run and return auth headers."""
    email = f"TEST_{uuid.uuid4().hex[:8]}@test.com"
    password = "testpass123"
    r = api_client.post(f"{API}/auth/register",
                        json={"email": email, "password": password, "full_name": "TEST User"})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    _session_state["email"] = email
    _session_state["password"] = password
    _session_state["user_id"] = r.json()["user"]["id"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# -------------------- Health --------------------
class TestHealth:
    def test_root(self, api_client):
        r = api_client.get(f"{API}/")
        assert r.status_code == 200
        j = r.json()
        assert j.get("status") == "ok"
        assert j.get("app") == "AutoSocial AI"


# -------------------- Auth --------------------
class TestAuth:
    def test_register_and_login(self, api_client):
        email = f"TEST_{uuid.uuid4().hex[:8]}@test.com"
        password = "pw123456"
        # register
        r = api_client.post(f"{API}/auth/register",
                            json={"email": email, "password": password, "full_name": "X"})
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        # Server lowercases emails
        assert data["user"]["email"] == email.lower()
        # duplicate register → 400
        r2 = api_client.post(f"{API}/auth/register",
                             json={"email": email, "password": password, "full_name": "X"})
        assert r2.status_code == 400
        # login
        r3 = api_client.post(f"{API}/auth/login",
                             json={"email": email, "password": password})
        assert r3.status_code == 200
        assert "access_token" in r3.json()
        # login wrong password
        r4 = api_client.post(f"{API}/auth/login",
                             json={"email": email, "password": "wrong"})
        assert r4.status_code == 401

    def test_demo_login(self, api_client):
        """Demo user from test_credentials.md"""
        r = api_client.post(f"{API}/auth/login",
                            json={"email": "demo@autosocial.ai", "password": "demo1234"})
        # Might not exist yet — try register then login
        if r.status_code != 200:
            api_client.post(f"{API}/auth/register",
                            json={"email": "demo@autosocial.ai", "password": "demo1234",
                                  "full_name": "Demo"})
            r = api_client.post(f"{API}/auth/login",
                                json={"email": "demo@autosocial.ai", "password": "demo1234"})
        assert r.status_code == 200, f"demo login failed: {r.text}"

    def test_me_requires_token(self, api_client):
        r = api_client.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_with_token(self, api_client, auth_headers):
        r = api_client.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        j = r.json()
        assert "user" in j
        assert j["user"]["email"].startswith("test_") or j["user"]["email"].startswith("TEST_".lower())


# -------------------- Business --------------------
class TestBusiness:
    def test_save_and_get(self, api_client, auth_headers):
        payload = {
            "business_name": "TEST Coffee",
            "business_type": "cafe",
            "description": "Artisanal coffee shop",
            "preferred_tone": "friendly",
            "posts_about": "new brews, latte art",
        }
        r = api_client.post(f"{API}/business", json=payload, headers=auth_headers)
        assert r.status_code == 200
        saved = r.json()
        assert saved["business_name"] == "TEST Coffee"
        assert "id" in saved
        # GET verifies persistence
        r2 = api_client.get(f"{API}/business", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["business_name"] == "TEST Coffee"


# -------------------- Social Connections --------------------
class TestSocial:
    def test_connect_disconnect(self, api_client, auth_headers):
        # initially empty or may contain earlier items — just verify list works
        r0 = api_client.get(f"{API}/social/connections", headers=auth_headers)
        assert r0.status_code == 200
        assert isinstance(r0.json(), list)

        # connect instagram
        r1 = api_client.post(f"{API}/social/connections",
                             json={"platform": "instagram", "account_name": "@testcafe"},
                             headers=auth_headers)
        assert r1.status_code == 200
        j = r1.json()
        assert j["platform"] == "instagram"
        assert j["status"] == "connected"
        assert j["account_name"] == "@testcafe"

        # list shows it
        r2 = api_client.get(f"{API}/social/connections", headers=auth_headers)
        platforms = [c["platform"] for c in r2.json()]
        assert "instagram" in platforms

        # disconnect
        r3 = api_client.delete(f"{API}/social/connections/instagram", headers=auth_headers)
        assert r3.status_code == 200
        r4 = api_client.get(f"{API}/social/connections", headers=auth_headers)
        platforms2 = [c["platform"] for c in r4.json()]
        assert "instagram" not in platforms2

        # reconnect for downstream publish tests
        api_client.post(f"{API}/social/connections",
                        json={"platform": "instagram", "account_name": "@testcafe"},
                        headers=auth_headers)


# -------------------- Uploads --------------------
# 1x1 tiny red JPEG generated once
_TINY_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcU"
    "FhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgo"
    "KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIA"
    "AhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEB"
    "AQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8A/9k="
)


class TestUploads:
    def test_upload(self, api_client, auth_headers):
        jpeg_b64 = _make_jpeg_b64()
        r = api_client.post(f"{API}/uploads",
                            json={"image_base64": jpeg_b64, "mime_type": "image/jpeg"},
                            headers=auth_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "id" in j
        assert j["data_uri"].startswith("data:image/jpeg;base64,")
        _session_state["upload_id"] = j["id"]


# -------------------- Image generation (real Gemini) --------------------
class TestImageGen:
    def test_generate_images(self, api_client, auth_headers):
        if "upload_id" not in _session_state:
            pytest.skip("upload_id not set by previous test")
        payload = {
            "uploaded_image_id": _session_state["upload_id"],
            "prompt": "cozy morning vibe with latte and pastries",
            "tone": "friendly",
            "post_goal": "general brand post",
        }
        r = api_client.post(f"{API}/generate/images", json=payload,
                            headers=auth_headers, timeout=180)
        assert r.status_code == 200, f"image gen failed: {r.status_code} {r.text[:500]}"
        j = r.json()
        imgs = j.get("images", [])
        assert len(imgs) >= 1, f"expected >=1 image, got {len(imgs)}"
        for img in imgs:
            assert "id" in img
            assert img["data_uri"].startswith("data:")
        _session_state["gen_image_id"] = imgs[0]["id"]
        _session_state["gen_image_count"] = len(imgs)


# -------------------- Caption generation (real GPT-5.2) --------------------
class TestCaptionGen:
    def test_generate_captions(self, api_client, auth_headers):
        if "gen_image_id" not in _session_state:
            pytest.skip("gen_image_id not set")
        payload = {
            "generated_image_id": _session_state["gen_image_id"],
            "prompt": "cozy morning vibe with latte and pastries",
            "tone": "friendly",
            "post_goal": "general brand post",
        }
        r = api_client.post(f"{API}/generate/captions", json=payload,
                            headers=auth_headers, timeout=90)
        assert r.status_code == 200, f"caption gen failed: {r.status_code} {r.text[:500]}"
        caps = r.json().get("captions", [])
        assert len(caps) == 3, f"expected 3 captions, got {len(caps)}"
        styles = {c["style"] for c in caps}
        # Should contain the 3 requested styles
        assert "short_catchy" in styles
        assert "friendly_local" in styles
        assert "promotional_cta" in styles
        for c in caps:
            assert c.get("caption"), "caption text missing"
            assert isinstance(c.get("hashtags", []), list)
        _session_state["gen_caption_id"] = caps[0]["id"]


# -------------------- Posts (mocked publish) & Dashboard --------------------
class TestPostsAndDashboard:
    def test_create_post_no_platform_fails(self, api_client, auth_headers):
        if "gen_image_id" not in _session_state or "gen_caption_id" not in _session_state:
            pytest.skip("prereqs missing")
        r = api_client.post(f"{API}/posts", json={
            "generated_image_id": _session_state["gen_image_id"],
            "generated_caption_id": _session_state["gen_caption_id"],
            "instagram_enabled": False,
            "facebook_enabled": False,
        }, headers=auth_headers)
        assert r.status_code == 400

    def test_create_post_and_list(self, api_client, auth_headers):
        if "gen_image_id" not in _session_state or "gen_caption_id" not in _session_state:
            pytest.skip("prereqs missing")
        r = api_client.post(f"{API}/posts", json={
            "generated_image_id": _session_state["gen_image_id"],
            "generated_caption_id": _session_state["gen_caption_id"],
            "instagram_enabled": True,
            "facebook_enabled": False,
        }, headers=auth_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["post"]["publish_status"] == "published"
        assert j["post"]["instagram_post_id"] is not None
        assert j["post"]["instagram_post_id"].startswith("mock_ig_")
        _session_state["post_id"] = j["post"]["id"]

        # List shows it
        r2 = api_client.get(f"{API}/posts", headers=auth_headers)
        assert r2.status_code == 200
        rows = r2.json()
        assert any(p["id"] == _session_state["post_id"] for p in rows)
        # Hydration check
        found = next(p for p in rows if p["id"] == _session_state["post_id"])
        assert found.get("image_data_uri", "").startswith("data:")
        assert found.get("caption_text")
        assert "metrics_total" in found
        assert found["metrics_total"]["impressions"] > 0

    def test_dashboard_summary(self, api_client, auth_headers):
        r = api_client.get(f"{API}/dashboard/summary", headers=auth_headers)
        assert r.status_code == 200
        j = r.json()
        assert j["total_posts"] >= 1
        assert j["published_count"] >= 1
        assert j["total_reach"] > 0
        assert j["most_recent"] is not None
