import os
import logging
import uuid
import base64
import asyncio
import json
import mimetypes
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, Literal

import jwt
import bcrypt
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from dotenv import load_dotenv

# -------------------- Setup --------------------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALG = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "168"))
KIE_API_KEY = os.environ.get("KIE_API_KEY", "")
KIE_API_BASE_URL = os.environ.get("KIE_API_BASE_URL", "https://api.kie.ai").rstrip("/")
KIE_IMAGE_MODEL = os.environ.get("KIE_IMAGE_MODEL", "nano-banana-2")
KIE_IMAGE_RESOLUTION = os.environ.get("KIE_IMAGE_RESOLUTION", "4K")
KIE_IMAGE_FORMAT = os.environ.get("KIE_IMAGE_FORMAT", "png")
KIE_IMAGE_ASPECT_RATIO = os.environ.get("KIE_IMAGE_ASPECT_RATIO", "auto")
KIE_POLL_INTERVAL_SECONDS = float(os.environ.get("KIE_POLL_INTERVAL_SECONDS", "2.5"))
KIE_POLL_TIMEOUT_SECONDS = int(os.environ.get("KIE_POLL_TIMEOUT_SECONDS", "180"))
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_API_BASE_URL = os.environ.get("OPENAI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_CAPTION_MODEL = os.environ.get("OPENAI_CAPTION_MODEL", "gpt-5.2")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="AutoSocial AI")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("autosocial")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return utcnow().isoformat()


def require_config(value: str, name: str):
    if not value:
        raise HTTPException(
            status_code=503,
            detail=f"{name} is not configured on the server yet.",
        )
    return value


def _raise_for_provider_error(resp: requests.Response, provider: str):
    try:
        payload = resp.json()
    except Exception:
        payload = None
    if resp.ok:
        return payload
    detail = None
    if isinstance(payload, dict):
        detail = payload.get("msg") or payload.get("message") or payload.get("error")
        if isinstance(detail, dict):
            detail = detail.get("message") or str(detail)
    if not detail:
        detail = resp.text[:500] or f"{provider} request failed"
    raise HTTPException(status_code=502, detail=f"{provider} error: {detail}")


async def _post_json(url: str, *, headers: dict, payload: dict, timeout: int = 60) -> dict:
    def _do_post():
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        return _raise_for_provider_error(resp, "Upstream API")

    return await asyncio.to_thread(_do_post)


async def _get_json(url: str, *, headers: dict, timeout: int = 60) -> dict:
    def _do_get():
        resp = requests.get(url, headers=headers, timeout=timeout)
        return _raise_for_provider_error(resp, "Upstream API")

    return await asyncio.to_thread(_do_get)


async def _get_binary(url: str, *, timeout: int = 120) -> tuple[bytes, str]:
    def _do_get():
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
        return resp.content, content_type

    try:
        return await asyncio.to_thread(_do_get)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Could not download generated image: {exc}") from exc


def _extract_result_urls(result_json: str | dict | list | None) -> list[str]:
    parsed = result_json
    if isinstance(result_json, str):
        try:
            parsed = json.loads(result_json)
        except Exception:
            return []
    if isinstance(parsed, dict):
        for key in ("resultUrls", "result_urls", "images", "urls", "output"):
            value = parsed.get(key)
            if isinstance(value, list):
                return [v for v in value if isinstance(v, str)]
        return []
    if isinstance(parsed, list):
        return [v for v in parsed if isinstance(v, str)]
    return []


async def _create_kie_image_task(prompt: str, image_b64: str, mime_type: str) -> str:
    require_config(KIE_API_KEY, "KIE_API_KEY")
    payload = {
        "model": KIE_IMAGE_MODEL,
        "input": {
            "prompt": prompt,
            "image_input": [f"data:{mime_type};base64,{image_b64}"],
            "aspect_ratio": KIE_IMAGE_ASPECT_RATIO,
            "resolution": KIE_IMAGE_RESOLUTION,
            "output_format": KIE_IMAGE_FORMAT,
        },
    }
    data = await _post_json(
        f"{KIE_API_BASE_URL}/api/v1/jobs/createTask",
        headers={"Authorization": f"Bearer {KIE_API_KEY}"},
        payload=payload,
        timeout=60,
    )
    task_id = ((data or {}).get("data") or {}).get("taskId")
    if not task_id:
        raise HTTPException(status_code=502, detail="Image provider did not return a task ID.")
    return task_id


async def _wait_for_kie_image(task_id: str) -> tuple[str, str]:
    deadline = asyncio.get_running_loop().time() + KIE_POLL_TIMEOUT_SECONDS
    headers = {"Authorization": f"Bearer {KIE_API_KEY}"}
    while True:
        data = await _get_json(
            f"{KIE_API_BASE_URL}/api/v1/jobs/recordInfo?taskId={task_id}",
            headers=headers,
            timeout=60,
        )
        job = (data or {}).get("data") or {}
        state = job.get("state")
        if state == "success":
            urls = _extract_result_urls(job.get("resultJson"))
            if not urls:
                raise HTTPException(status_code=502, detail="Image provider finished without returning an image URL.")
            image_bytes, content_type = await _get_binary(urls[0])
            mime_type = content_type or mimetypes.guess_type(urls[0])[0] or "image/png"
            return base64.b64encode(image_bytes).decode("utf-8"), mime_type
        if state == "fail":
            fail_msg = job.get("failMsg") or "Image generation failed."
            raise HTTPException(status_code=502, detail=f"Image provider error: {fail_msg}")
        if asyncio.get_running_loop().time() >= deadline:
            raise HTTPException(status_code=504, detail="Image generation timed out.")
        await asyncio.sleep(KIE_POLL_INTERVAL_SECONDS)


async def _generate_openai_caption_json(prompt: str, image_b64: str, mime_type: str) -> dict:
    require_config(OPENAI_API_KEY, "OPENAI_API_KEY")
    payload = {
        "model": OPENAI_CAPTION_MODEL,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "You write short, natural, scroll-stopping social-media captions for small local businesses. "
                            "Look carefully at the attached image and tie the captions to what is actually visible. "
                            "Return only valid JSON matching the requested schema."
                        ),
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {
                        "type": "input_image",
                        "image_url": f"data:{mime_type};base64,{image_b64}",
                    },
                ],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "captions_response",
                "schema": {
                    "type": "object",
                    "properties": {
                        "captions": {
                            "type": "array",
                            "minItems": 3,
                            "maxItems": 3,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "style": {"type": "string"},
                                    "caption": {"type": "string"},
                                    "hashtags": {
                                        "type": "array",
                                        "minItems": 3,
                                        "maxItems": 6,
                                        "items": {"type": "string"},
                                    },
                                    "cta": {"type": "string"},
                                },
                                "required": ["style", "caption", "hashtags", "cta"],
                                "additionalProperties": False,
                            },
                        }
                    },
                    "required": ["captions"],
                    "additionalProperties": False,
                },
            }
        },
    }
    data = await _post_json(
        f"{OPENAI_API_BASE_URL}/responses",
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        payload=payload,
        timeout=90,
    )
    output_text = data.get("output_text")
    if output_text:
        return json.loads(output_text)
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return json.loads(content["text"])
    raise HTTPException(status_code=502, detail="Caption provider returned an unexpected response.")


# -------------------- Models --------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class BusinessIn(BaseModel):
    business_name: str
    business_type: str
    description: Optional[str] = ""
    preferred_tone: Optional[str] = "friendly"
    posts_about: Optional[str] = ""


class SocialConnectIn(BaseModel):
    platform: Literal["instagram", "facebook", "tiktok"]
    account_name: str


class UploadIn(BaseModel):
    image_base64: str  # raw base64 (no data: prefix)
    mime_type: str = "image/jpeg"


class GenerateImagesIn(BaseModel):
    uploaded_image_id: str
    prompt: str
    tone: Optional[str] = "friendly"
    post_goal: Optional[str] = "general brand post"


class GenerateCaptionsIn(BaseModel):
    generated_image_id: str
    prompt: str
    tone: Optional[str] = "friendly"
    post_goal: Optional[str] = "general brand post"


class CreatePostIn(BaseModel):
    generated_image_id: str
    generated_caption_id: str
    instagram_enabled: bool = True
    facebook_enabled: bool = False
    tiktok_enabled: bool = False
    schedule_for: Optional[str] = None  # ISO string; None = now


# -------------------- Auth helpers --------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": utcnow() + timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# -------------------- Auth routes --------------------
@api_router.post("/auth/register", response_model=TokenOut)
async def register(data: RegisterIn):
    existing = await db.users.find_one({"email": data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": data.email.lower(),
        "full_name": data.full_name or "",
        "password_hash": hash_password(data.password),
        "created_at": now_iso(),
        "onboarded": False,
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_id, user_doc["email"])
    user_doc.pop("password_hash", None)
    user_doc.pop("_id", None)
    return TokenOut(access_token=token, user=user_doc)


@api_router.post("/auth/login", response_model=TokenOut)
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["email"])
    user.pop("password_hash", None)
    user.pop("_id", None)
    return TokenOut(access_token=token, user=user)


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    biz = await db.businesses.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"user": user, "business": biz}


# -------------------- Business / Onboarding --------------------
@api_router.post("/business")
async def save_business(data: BusinessIn, user=Depends(get_current_user)):
    existing = await db.businesses.find_one({"user_id": user["id"]})
    doc = data.dict()
    doc["user_id"] = user["id"]
    doc["updated_at"] = now_iso()
    if existing:
        await db.businesses.update_one({"user_id": user["id"]}, {"$set": doc})
        doc["id"] = existing["id"]
        doc["created_at"] = existing.get("created_at", now_iso())
    else:
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = now_iso()
        await db.businesses.insert_one(doc.copy())
    await db.users.update_one({"id": user["id"]}, {"$set": {"onboarded": True}})
    doc.pop("_id", None)
    return doc


@api_router.get("/business")
async def get_business(user=Depends(get_current_user)):
    biz = await db.businesses.find_one({"user_id": user["id"]}, {"_id": 0})
    return biz or {}


# -------------------- Social Connections (mocked) --------------------
@api_router.get("/social/connections")
async def list_connections(user=Depends(get_current_user)):
    rows = await db.social_connections.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    return rows


@api_router.post("/social/connections")
async def connect_social(data: SocialConnectIn, user=Depends(get_current_user)):
    existing = await db.social_connections.find_one({"user_id": user["id"], "platform": data.platform})
    doc = {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "user_id": user["id"],
        "platform": data.platform,
        "account_name": data.account_name,
        "account_id": f"mock_{data.platform}_{uuid.uuid4().hex[:8]}",
        "status": "connected",
        "access_token_encrypted_or_placeholder": "MOCKED_TOKEN",
        "created_at": existing.get("created_at", now_iso()) if existing else now_iso(),
    }
    if existing:
        await db.social_connections.update_one(
            {"user_id": user["id"], "platform": data.platform}, {"$set": doc}
        )
    else:
        await db.social_connections.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


@api_router.delete("/social/connections/{platform}")
async def disconnect_social(platform: str, user=Depends(get_current_user)):
    await db.social_connections.delete_one({"user_id": user["id"], "platform": platform})
    return {"status": "disconnected", "platform": platform}


# -------------------- Upload --------------------
@api_router.post("/uploads")
async def upload_image(data: UploadIn, user=Depends(get_current_user)):
    # Basic size guard ~ 8MB base64
    if len(data.image_base64) > 12_000_000:
        raise HTTPException(status_code=413, detail="Image is too large. Please use a smaller photo.")
    upload_id = str(uuid.uuid4())
    doc = {
        "id": upload_id,
        "user_id": user["id"],
        "mime_type": data.mime_type,
        "image_base64": data.image_base64,
        "created_at": now_iso(),
    }
    await db.uploaded_images.insert_one(doc.copy())
    return {
        "id": upload_id,
        "mime_type": data.mime_type,
        "data_uri": f"data:{data.mime_type};base64,{data.image_base64}",
        "created_at": doc["created_at"],
    }


# -------------------- Image generation --------------------
DAILY_IMAGE_GEN_LIMIT = 6


def _today_utc_date_str() -> str:
    return utcnow().strftime("%Y-%m-%d")


async def _count_today_requests(user_id: str) -> int:
    return await db.generation_requests.count_documents({
        "user_id": user_id,
        "day": _today_utc_date_str(),
    })


AD_STYLE_VARIATIONS = [
    "Style A — warm lifestyle: place the subject in a cozy, inviting setting with warm natural light, soft bokeh background, and subtle props. Keep the hero product sharp and centered. High-quality commercial photo, magazine-style.",
    "Style B — bold minimal studio: clean solid pastel or gradient backdrop matching the requested vibe, dramatic single-source lighting, strong shadows, the subject hero-framed with generous negative space for text overlay. Premium ad look.",
    "Style C — vibrant flat-lay: top-down composition, complementary textured surface, a few tasteful supporting elements around the subject, balanced composition, bright and appetizing colours, social-media scroll-stopping aesthetic.",
]


async def _generate_single_ad_image(image_b64: str, mime_type: str, prompt: str, tone: str,
                                     post_goal: str, variation_text: str, idx: int) -> Optional[dict]:
    """Call Nano Banana 2 and return {data, mime_type} or None."""
    system_msg = (
        "You are a professional product photographer and ad art director. "
        "When given a reference product photo, you redesign the scene for a social-media ad "
        "while keeping the hero product clearly recognizable and undistorted. "
        "Produce high-quality, realistic, commercial-grade imagery. Do not add text or logos."
    )
    full_prompt = (
        f"Using this uploaded product/subject image as the hero, create a polished marketing ad photo.\n\n"
        f"USER REQUEST: {prompt}\n"
        f"TONE: {tone}\n"
        f"POST GOAL: {post_goal}\n\n"
        f"{variation_text}\n\n"
        f"Critical rules:\n"
        f"- The original subject must remain clearly recognizable and un-distorted\n"
        f"- No text, no words, no logos in the image\n"
        f"- Clean composition, the subject is the hero\n"
        f"- Realistic, high-end commercial quality\n"
        f"- No watermarks"
    )
    try:
        task_id = await _create_kie_image_task(f"{system_msg}\n\n{full_prompt}", image_b64, mime_type)
        image_data, output_mime = await _wait_for_kie_image(task_id)
        return {"data": image_data, "mime_type": output_mime}
    except Exception as e:
        logger.exception(f"Image gen variation {idx} failed: {e}")
    return None


@api_router.post("/generate/images")
async def generate_images(data: GenerateImagesIn, user=Depends(get_current_user)):
    upload = await db.uploaded_images.find_one({"id": data.uploaded_image_id, "user_id": user["id"]})
    if not upload:
        raise HTTPException(status_code=404, detail="Uploaded image not found")

    # Enforce daily rate limit (per user, UTC day) BEFORE spending AI credits
    used_today = await _count_today_requests(user["id"])
    if used_today >= DAILY_IMAGE_GEN_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"You've reached today's limit of {DAILY_IMAGE_GEN_LIMIT} ad image generations. Please come back tomorrow.",
        )

    # Record the request up-front so parallel calls can't race past the cap
    req_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "day": _today_utc_date_str(),
        "prompt": data.prompt,
        "created_at": now_iso(),
    }
    await db.generation_requests.insert_one(req_doc.copy())

    # Generate 3 variations in parallel
    tasks = [
        _generate_single_ad_image(
            upload["image_base64"], upload["mime_type"],
            data.prompt, data.tone or "friendly", data.post_goal or "general brand post",
            AD_STYLE_VARIATIONS[i], i,
        )
        for i in range(3)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=False)

    generated = []
    for i, res in enumerate(results):
        if res is None:
            continue
        gen_id = str(uuid.uuid4())
        doc = {
            "id": gen_id,
            "uploaded_image_id": data.uploaded_image_id,
            "user_id": user["id"],
            "image_base64": res["data"],
            "mime_type": res["mime_type"],
            "generation_prompt": data.prompt,
            "variation_index": i,
            "style_name": ["Warm lifestyle", "Bold minimal", "Vibrant flat-lay"][i],
            "created_at": now_iso(),
            "is_selected": False,
        }
        await db.generated_images.insert_one(doc.copy())
        generated.append({
            "id": gen_id,
            "variation_index": i,
            "style_name": doc["style_name"],
            "data_uri": f"data:{res['mime_type']};base64,{res['data']}",
        })

    if not generated:
        # Refund the quota if the entire batch failed (nothing usable produced)
        await db.generation_requests.delete_one({"id": req_doc["id"]})
        raise HTTPException(status_code=502, detail="We couldn't generate your ad images right now. Please try again.")
    return {
        "images": generated,
        "usage": {
            "used_today": used_today + 1,
            "limit": DAILY_IMAGE_GEN_LIMIT,
            "remaining": max(0, DAILY_IMAGE_GEN_LIMIT - (used_today + 1)),
        },
    }


@api_router.get("/usage/today")
async def usage_today(user=Depends(get_current_user)):
    used = await _count_today_requests(user["id"])
    return {
        "used_today": used,
        "limit": DAILY_IMAGE_GEN_LIMIT,
        "remaining": max(0, DAILY_IMAGE_GEN_LIMIT - used),
        "day": _today_utc_date_str(),
    }


# -------------------- Caption generation (GPT-5.2) --------------------
@api_router.post("/generated-images/{image_id}/select")
async def select_generated_image(image_id: str, user=Depends(get_current_user)):
    """User picks one of the 3 generated ad images.
    Marks the chosen one as selected and DELETES the other non-selected
    sibling variations (same uploaded_image_id) to avoid storing discarded drafts.
    """
    chosen = await db.generated_images.find_one({"id": image_id, "user_id": user["id"]})
    if not chosen:
        raise HTTPException(status_code=404, detail="Generated image not found")

    # Delete all sibling images for the same upload, keep only the chosen one
    result = await db.generated_images.delete_many({
        "user_id": user["id"],
        "uploaded_image_id": chosen["uploaded_image_id"],
        "id": {"$ne": image_id},
    })
    # Also drop any captions previously attached to those siblings
    await db.generated_captions.delete_many({
        "user_id": user["id"],
        "generated_image_id": {"$ne": image_id},
        "is_selected": False,
    })
    # Mark chosen as selected
    await db.generated_images.update_one(
        {"id": image_id, "user_id": user["id"]},
        {"$set": {"is_selected": True}},
    )
    return {"id": image_id, "deleted_siblings": result.deleted_count}


@api_router.post("/generate/captions")
async def generate_captions(data: GenerateCaptionsIn, user=Depends(get_current_user)):
    gen_img = await db.generated_images.find_one({"id": data.generated_image_id, "user_id": user["id"]})
    if not gen_img:
        raise HTTPException(status_code=404, detail="Generated image not found")
    business = await db.businesses.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    biz_name = business.get("business_name", "our business")
    biz_type = business.get("business_type", "local shop")

    system_msg = (
        "You write short, natural, scroll-stopping social-media captions for small local businesses. "
        "You are given the actual ad image the user selected — look at it carefully and reference what is "
        "visually in the image (setting, colours, mood, what the product looks like) so the caption truly "
        "matches the picture. Your captions sound human, warm, and never robotic. You never use hashtags "
        "inline with sentences. Return ONLY valid JSON, no extra text, no markdown."
    )
    prompt = f"""Create 3 Instagram/Facebook caption options for a local business post, based on the ATTACHED AD IMAGE.

Business name: {biz_name}
Business type: {biz_type}
User request about the post: {data.prompt}
Desired tone: {data.tone}
Post goal: {data.post_goal}

First, briefly consider what is actually visible in the attached image (the product, the setting, the mood,
key colours, any notable props). Then write captions that feel tied to THAT specific image — not generic.

Write exactly 3 caption options, each in a different style:
1. "short_catchy" — very short (under 15 words), punchy, playful.
2. "friendly_local" — warm, personal, like talking to a neighbour (2-3 sentences).
3. "promotional_cta" — promotional with a clear call-to-action (2-3 sentences, gently persuasive).

For each, provide:
- style
- caption (the main text, NO hashtags inside)
- hashtags (array of 3-6 relevant hashtags that fit BOTH the business and what's shown in the image)
- cta (short call-to-action line, or empty string)

Return ONLY valid JSON in this shape (no markdown, no backticks):
{{"captions":[{{"style":"short_catchy","caption":"...","hashtags":["#..."],"cta":"..."}},{{"style":"friendly_local","caption":"...","hashtags":["#..."],"cta":"..."}},{{"style":"promotional_cta","caption":"...","hashtags":["#..."],"cta":"..."}}]}}
"""
    try:
        parsed = await _generate_openai_caption_json(
            prompt,
            gen_img["image_base64"],
            gen_img.get("mime_type", "image/png"),
        )
    except Exception:
        logger.exception("Caption gen failed")
        raise HTTPException(status_code=502, detail="We couldn't generate captions right now. Please try again.")

    captions_out = []
    for c in parsed.get("captions", [])[:3]:
        cap_id = str(uuid.uuid4())
        style = c.get("style", "friendly_local")
        caption = c.get("caption", "")
        hashtags = c.get("hashtags", []) or []
        cta = c.get("cta", "") or ""
        doc = {
            "id": cap_id,
            "user_id": user["id"],
            "generated_image_id": data.generated_image_id,
            "caption_text": caption,
            "hashtags": hashtags,
            "cta": cta,
            "caption_style": style,
            "is_selected": False,
            "created_at": now_iso(),
        }
        await db.generated_captions.insert_one(doc.copy())
        captions_out.append({
            "id": cap_id,
            "style": style,
            "caption": caption,
            "hashtags": hashtags,
            "cta": cta,
        })
    if not captions_out:
        raise HTTPException(status_code=502, detail="No captions produced. Please try again.")
    return {"captions": captions_out}


# -------------------- Posts (mocked publish) --------------------
STYLE_TITLE = {
    "short_catchy": "Short & catchy",
    "friendly_local": "Friendly local",
    "promotional_cta": "Promotional",
}


@api_router.post("/posts")
async def create_post(data: CreatePostIn, user=Depends(get_current_user)):
    gen_img = await db.generated_images.find_one({"id": data.generated_image_id, "user_id": user["id"]})
    gen_cap = await db.generated_captions.find_one({"id": data.generated_caption_id, "user_id": user["id"]})
    if not gen_img or not gen_cap:
        raise HTTPException(status_code=404, detail="Selected image or caption not found.")

    if not (data.instagram_enabled or data.facebook_enabled or data.tiktok_enabled):
        raise HTTPException(status_code=400, detail="Please choose at least one platform to publish to.")

    connections = await db.social_connections.find({"user_id": user["id"]}, {"_id": 0}).to_list(10)
    connected_platforms = {c["platform"] for c in connections if c.get("status") == "connected"}

    # Mark as selected
    await db.generated_images.update_one({"id": gen_img["id"]}, {"$set": {"is_selected": True}})
    await db.generated_captions.update_one({"id": gen_cap["id"]}, {"$set": {"is_selected": True}})

    post_id = str(uuid.uuid4())
    now = now_iso()
    scheduled = data.schedule_for
    publish_status = "scheduled" if scheduled else "published"
    published_at = None if scheduled else now

    import random
    ig_post_id = f"mock_ig_{uuid.uuid4().hex[:10]}" if data.instagram_enabled and not scheduled else None
    fb_post_id = f"mock_fb_{uuid.uuid4().hex[:10]}" if data.facebook_enabled and not scheduled else None
    tt_post_id = f"mock_tt_{uuid.uuid4().hex[:10]}" if data.tiktok_enabled and not scheduled else None

    # If platform toggled on but not connected → warn by marking failed for that platform (MVP: still succeed)
    warnings = []
    if data.instagram_enabled and "instagram" not in connected_platforms:
        warnings.append("Instagram account is not connected — this post was saved but not actually sent.")
    if data.facebook_enabled and "facebook" not in connected_platforms:
        warnings.append("Facebook account is not connected — this post was saved but not actually sent.")

    post_doc = {
        "id": post_id,
        "user_id": user["id"],
        "generated_image_id": gen_img["id"],
        "generated_caption_id": gen_cap["id"],
        "instagram_enabled": data.instagram_enabled,
        "facebook_enabled": data.facebook_enabled,
        "tiktok_enabled": data.tiktok_enabled,
        "publish_status": publish_status,
        "published_at": published_at,
        "scheduled_for": scheduled,
        "instagram_post_id": ig_post_id,
        "facebook_post_id": fb_post_id,
        "tiktok_post_id": tt_post_id,
        "created_at": now,
        "warnings": warnings,
    }
    await db.posts.insert_one(post_doc.copy())

    # Seed mock metrics if published now
    if publish_status == "published":
        for platform in (
            (["instagram"] if data.instagram_enabled else [])
            + (["facebook"] if data.facebook_enabled else [])
            + (["tiktok"] if data.tiktok_enabled else [])
        ):
            metric = {
                "id": str(uuid.uuid4()),
                "post_id": post_id,
                "platform": platform,
                "impressions": random.randint(250, 1200),
                "reach": random.randint(150, 900),
                "likes": random.randint(12, 180),
                "comments": random.randint(0, 30),
                "clicks": random.randint(2, 45),
                "fetched_at": now,
            }
            await db.post_metrics.insert_one(metric.copy())

    await db.job_logs.insert_one({
        "id": str(uuid.uuid4()),
        "job_type": "publish_post",
        "status": publish_status,
        "message": "; ".join(warnings) if warnings else "ok",
        "related_post_id": post_id,
        "created_at": now,
    })

    post_doc.pop("_id", None)
    return {"post": post_doc, "warnings": warnings}


async def _hydrate_post(post: dict) -> dict:
    gi = await db.generated_images.find_one(
        {"id": post["generated_image_id"]},
        {"_id": 0, "image_base64": 1, "mime_type": 1, "style_name": 1},
    )
    gc = await db.generated_captions.find_one(
        {"id": post["generated_caption_id"]},
        {"_id": 0, "caption_text": 1, "hashtags": 1, "cta": 1, "caption_style": 1},
    )
    metrics = await db.post_metrics.find({"post_id": post["id"]}, {"_id": 0}).to_list(10)
    total = {"impressions": 0, "reach": 0, "likes": 0, "comments": 0, "clicks": 0}
    for m in metrics:
        for k in total:
            total[k] += int(m.get(k, 0) or 0)
    out = dict(post)
    out.pop("_id", None)
    if gi:
        out["image_data_uri"] = f"data:{gi.get('mime_type','image/png')};base64,{gi['image_base64']}"
        out["image_style"] = gi.get("style_name")
    if gc:
        out["caption_text"] = gc.get("caption_text", "")
        out["caption_hashtags"] = gc.get("hashtags", [])
        out["caption_cta"] = gc.get("cta", "")
        out["caption_style"] = gc.get("caption_style", "")
    out["metrics_total"] = total
    out["metrics_by_platform"] = metrics
    return out


@api_router.get("/posts")
async def list_posts(user=Depends(get_current_user)):
    rows = await db.posts.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    hydrated = [await _hydrate_post(r) for r in rows]
    return hydrated


@api_router.get("/posts/{post_id}")
async def get_post(post_id: str, user=Depends(get_current_user)):
    row = await db.posts.find_one({"id": post_id, "user_id": user["id"]}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Post not found")
    return await _hydrate_post(row)


# -------------------- Dashboard --------------------
@api_router.get("/dashboard/summary")
async def dashboard_summary(user=Depends(get_current_user)):
    posts = await db.posts.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    total_posts = len(posts)
    published_posts = [p for p in posts if p.get("publish_status") == "published"]

    best = None
    best_reach = -1
    recent_hydrated = None
    reach_total = 0
    likes_total = 0

    for p in published_posts:
        metrics = await db.post_metrics.find({"post_id": p["id"]}, {"_id": 0}).to_list(10)
        r = sum(int(m.get("reach", 0) or 0) for m in metrics)
        lk = sum(int(m.get("likes", 0) or 0) for m in metrics)
        reach_total += r
        likes_total += lk
        if r > best_reach:
            best_reach = r
            best = p

    if posts:
        recent_hydrated = await _hydrate_post(posts[0])
    best_hydrated = await _hydrate_post(best) if best else None

    return {
        "total_posts": total_posts,
        "published_count": len(published_posts),
        "total_reach": reach_total,
        "total_likes": likes_total,
        "most_recent": recent_hydrated,
        "best_performing": best_hydrated,
    }


# -------------------- Health --------------------
@api_router.get("/")
async def root():
    return {"app": "AutoSocial AI", "status": "ok", "time": now_iso()}


# -------------------- Wire up --------------------
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
