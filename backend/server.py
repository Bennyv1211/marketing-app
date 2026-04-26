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
from urllib.parse import urlencode

import jwt
import bcrypt
import requests
import boto3
from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.responses import HTMLResponse, RedirectResponse
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
KIE_UPLOAD_BASE_URL = os.environ.get("KIE_UPLOAD_BASE_URL", "https://kieai.redpandaai.co").rstrip("/")
KIE_IMAGE_MODEL = os.environ.get("KIE_IMAGE_MODEL", "nano-banana-2")
KIE_IMAGE_RESOLUTION = os.environ.get("KIE_IMAGE_RESOLUTION", "1K")
KIE_IMAGE_FORMAT = os.environ.get("KIE_IMAGE_FORMAT", "png")
KIE_IMAGE_ASPECT_RATIO = os.environ.get("KIE_IMAGE_ASPECT_RATIO", "auto")
KIE_POLL_INTERVAL_SECONDS = float(os.environ.get("KIE_POLL_INTERVAL_SECONDS", "2.5"))
KIE_POLL_TIMEOUT_SECONDS = int(os.environ.get("KIE_POLL_TIMEOUT_SECONDS", "180"))
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_API_BASE_URL = os.environ.get("OPENAI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_CAPTION_MODEL = os.environ.get("OPENAI_CAPTION_MODEL", "gpt-5.2")
OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
OPENAI_IMAGE_QUALITY = os.environ.get("OPENAI_IMAGE_QUALITY", "low")
OPENAI_IMAGE_SIZE = os.environ.get("OPENAI_IMAGE_SIZE", "1024x1024")
OPENAI_IMAGE_VARIATIONS = int(os.environ.get("OPENAI_IMAGE_VARIATIONS", "1"))
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "")
R2_PRESIGNED_URL_EXPIRE_SECONDS = int(os.environ.get("R2_PRESIGNED_URL_EXPIRE_SECONDS", "86400"))
META_APP_ID = os.environ.get("META_APP_ID", "").strip()
META_APP_SECRET = os.environ.get("META_APP_SECRET", "").strip()
META_REDIRECT_URI = os.environ.get("META_REDIRECT_URI", "").strip()
META_GRAPH_API_BASE_URL = os.environ.get("META_GRAPH_API_BASE_URL", "https://graph.facebook.com/v23.0").rstrip("/")
META_OAUTH_BASE_URL = os.environ.get("META_OAUTH_BASE_URL", "https://www.facebook.com/v23.0").rstrip("/")
META_APP_REDIRECT_URI = os.environ.get("META_APP_REDIRECT_URI", "adflow://connect").strip()
R2_ENDPOINT_URL = (
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com".rstrip("/")
    if R2_ACCOUNT_ID
    else ""
)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="AdFlow")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("adflow")


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


def _meta_redirect_with_status(app_redirect_uri: str, *, status_value: str, message: str = "", platforms: str = "", extra: Optional[dict] = None):
    separator = "&" if "?" in app_redirect_uri else "?"
    params = {
        "status": status_value,
        "message": message,
        "platforms": platforms,
    }
    if extra:
        params.update({k: v for k, v in extra.items() if v is not None})
    query = urlencode(params)
    return RedirectResponse(f"{app_redirect_uri}{separator}{query}", status_code=302)


def _r2_client():
    require_config(R2_ACCOUNT_ID, "R2_ACCOUNT_ID")
    require_config(R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID")
    require_config(R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY")
    require_config(R2_BUCKET_NAME, "R2_BUCKET_NAME")
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


async def _upload_bytes_to_r2(content: bytes, key: str, mime_type: str) -> dict:
    def _do_upload():
        client = _r2_client()
        client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=content,
            ContentType=mime_type,
        )
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET_NAME, "Key": key},
            ExpiresIn=R2_PRESIGNED_URL_EXPIRE_SECONDS,
        )
        return {"key": key, "url": url}

    try:
        return await asyncio.to_thread(_do_upload)
    except Exception as exc:
        logger.exception("R2 upload failed")
        raise HTTPException(status_code=502, detail=f"Image storage error: {exc}") from exc


async def _read_bytes_from_r2(key: str) -> bytes:
    def _do_read():
        client = _r2_client()
        obj = client.get_object(Bucket=R2_BUCKET_NAME, Key=key)
        return obj["Body"].read()

    try:
        return await asyncio.to_thread(_do_read)
    except Exception as exc:
        logger.exception("R2 read failed")
        raise HTTPException(status_code=502, detail=f"Image storage read error: {exc}") from exc


async def _signed_r2_url(key: str) -> str:
    def _do_sign():
        client = _r2_client()
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET_NAME, "Key": key},
            ExpiresIn=R2_PRESIGNED_URL_EXPIRE_SECONDS,
        )

    try:
        return await asyncio.to_thread(_do_sign)
    except Exception as exc:
        logger.exception("R2 URL signing failed")
        raise HTTPException(status_code=502, detail=f"Image storage URL error: {exc}") from exc


async def _ensure_uploaded_image_in_r2(upload_doc: dict) -> tuple[bytes, str]:
    mime_type = upload_doc.get("mime_type", "image/jpeg")
    storage_key = upload_doc.get("storage_key")
    if storage_key:
        return await _read_bytes_from_r2(storage_key), mime_type

    legacy_b64 = upload_doc.get("image_base64")
    if not legacy_b64:
        raise HTTPException(status_code=500, detail="Uploaded image is missing stored content.")

    image_bytes = base64.b64decode(legacy_b64)
    upload_id = upload_doc.get("id", str(uuid.uuid4()))
    user_id = upload_doc.get("user_id", "legacy")
    key = f"uploads/{user_id}/{upload_id}.{(mimetypes.guess_extension(mime_type) or '.jpg').lstrip('.')}"
    stored = await _upload_bytes_to_r2(image_bytes, key, mime_type)
    await db.uploaded_images.update_one(
        {"id": upload_doc["id"]},
        {"$set": {"storage_key": stored["key"]}, "$unset": {"image_base64": ""}},
    )
    upload_doc["storage_key"] = stored["key"]
    upload_doc.pop("image_base64", None)
    return image_bytes, mime_type


async def _ensure_generated_image_in_r2(generated_doc: dict) -> tuple[bytes, str]:
    mime_type = generated_doc.get("mime_type", "image/png")
    storage_key = generated_doc.get("storage_key")
    if storage_key:
        return await _read_bytes_from_r2(storage_key), mime_type

    legacy_b64 = generated_doc.get("image_base64")
    if not legacy_b64:
        raise HTTPException(status_code=500, detail="Generated image is missing stored content.")

    image_bytes = base64.b64decode(legacy_b64)
    image_id = generated_doc.get("id", str(uuid.uuid4()))
    user_id = generated_doc.get("user_id", "legacy")
    key = f"generated/{user_id}/{image_id}.{(mimetypes.guess_extension(mime_type) or '.png').lstrip('.')}"
    stored = await _upload_bytes_to_r2(image_bytes, key, mime_type)
    await db.generated_images.update_one(
        {"id": generated_doc["id"]},
        {"$set": {"storage_key": stored["key"]}, "$unset": {"image_base64": ""}},
    )
    generated_doc["storage_key"] = stored["key"]
    generated_doc.pop("image_base64", None)
    return image_bytes, mime_type


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


async def _post_multipart(url: str, *, headers: dict, data: dict, files: list[tuple[str, tuple]], timeout: int = 120) -> dict:
    def _do_post():
        resp = requests.post(url, headers=headers, data=data, files=files, timeout=timeout)
        return _raise_for_provider_error(resp, "Upstream API")

    return await asyncio.to_thread(_do_post)


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


def _meta_headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


async def _meta_get(path: str, *, access_token: str, params: Optional[dict] = None) -> dict:
    query = urlencode(params or {})
    url = f"{META_GRAPH_API_BASE_URL}{path}"
    if query:
        url = f"{url}?{query}"
    return await _get_json(url, headers=_meta_headers(access_token), timeout=60)


async def _exchange_meta_code_for_user_token(code: str) -> str:
    require_config(META_APP_ID, "META_APP_ID")
    require_config(META_APP_SECRET, "META_APP_SECRET")
    require_config(META_REDIRECT_URI, "META_REDIRECT_URI")
    params = urlencode(
        {
            "client_id": META_APP_ID,
            "client_secret": META_APP_SECRET,
            "redirect_uri": META_REDIRECT_URI,
            "code": code,
        }
    )
    token_data = await _get_json(
        f"{META_GRAPH_API_BASE_URL}/oauth/access_token?{params}",
        headers={},
        timeout=60,
    )
    user_token = token_data.get("access_token")
    if not user_token:
        raise HTTPException(status_code=502, detail="Meta did not return a user access token.")

    exchange_params = urlencode(
        {
            "grant_type": "fb_exchange_token",
            "client_id": META_APP_ID,
            "client_secret": META_APP_SECRET,
            "fb_exchange_token": user_token,
        }
    )
    exchange_data = await _get_json(
        f"{META_GRAPH_API_BASE_URL}/oauth/access_token?{exchange_params}",
        headers={},
        timeout=60,
    )
    return exchange_data.get("access_token") or user_token


async def _upsert_social_connection(
    *,
    user_id: str,
    platform: str,
    account_name: str,
    account_id: str,
    access_token: str,
    metadata: Optional[dict] = None,
):
    existing = await db.social_connections.find_one({"user_id": user_id, "platform": platform})
    doc = {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "user_id": user_id,
        "platform": platform,
        "account_name": account_name,
        "account_id": account_id,
        "status": "connected",
        "access_token": access_token,
        "metadata": metadata or {},
        "created_at": existing.get("created_at", now_iso()) if existing else now_iso(),
        "updated_at": now_iso(),
    }
    if existing:
        await db.social_connections.update_one(
            {"user_id": user_id, "platform": platform},
            {"$set": doc},
        )
    else:
        await db.social_connections.insert_one(doc.copy())
    return doc


async def _publish_facebook_photo(*, page_id: str, access_token: str, image_url: str, caption_text: str) -> str:
    payload = {
        "url": image_url,
        "caption": caption_text,
        "published": True,
    }
    data = await _post_json(
        f"{META_GRAPH_API_BASE_URL}/{page_id}/photos?access_token={access_token}",
        headers={"Content-Type": "application/json"},
        payload=payload,
        timeout=120,
    )
    post_id = data.get("post_id") or data.get("id")
    if not post_id:
        raise HTTPException(status_code=502, detail="Meta did not return a Facebook post ID.")
    return post_id


async def _publish_instagram_photo(*, instagram_account_id: str, access_token: str, image_url: str, caption_text: str) -> str:
    create_payload = {
        "image_url": image_url,
        "caption": caption_text,
    }
    create_data = await _post_json(
        f"{META_GRAPH_API_BASE_URL}/{instagram_account_id}/media?access_token={access_token}",
        headers={"Content-Type": "application/json"},
        payload=create_payload,
        timeout=120,
    )
    creation_id = create_data.get("id")
    if not creation_id:
        raise HTTPException(status_code=502, detail="Meta did not return an Instagram media container ID.")

    publish_data = await _post_json(
        f"{META_GRAPH_API_BASE_URL}/{instagram_account_id}/media_publish?access_token={access_token}",
        headers={"Content-Type": "application/json"},
        payload={"creation_id": creation_id},
        timeout=120,
    )
    media_id = publish_data.get("id")
    if not media_id:
        raise HTTPException(status_code=502, detail="Meta did not return an Instagram media ID.")
    return media_id


async def _store_meta_connection_for_page(*, user_id: str, profile: dict, page_option: dict, requested_platform: str, access_token: str):
    page_id = page_option["page_id"]
    page_name = page_option.get("page_name") or "Facebook Page"
    page_token = page_option.get("page_access_token") or access_token
    instagram_account = page_option.get("instagram_account")

    if requested_platform == "instagram" and not instagram_account:
        raise HTTPException(
            status_code=400,
            detail="The selected Facebook Page does not have a linked Instagram business account.",
        )

    connected_platforms: list[str] = []
    if requested_platform in {"facebook", "instagram"}:
        await _upsert_social_connection(
            user_id=user_id,
            platform="facebook",
            account_name=page_name,
            account_id=page_id,
            access_token=page_token,
            metadata={
                "meta_user_id": profile.get("id"),
                "meta_user_name": profile.get("name"),
                "meta_user_email": profile.get("email"),
            },
        )
        connected_platforms.append("facebook")

    if instagram_account:
        await _upsert_social_connection(
            user_id=user_id,
            platform="instagram",
            account_name=instagram_account.get("username") or instagram_account.get("name") or "Instagram Business",
            account_id=instagram_account["id"],
            access_token=page_token,
            metadata={
                "facebook_page_id": page_id,
                "facebook_page_name": page_name,
            },
        )
        connected_platforms.append("instagram")

    return connected_platforms


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


def _extract_kie_task_id(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    candidates: list[dict] = [payload]
    data = payload.get("data")
    if isinstance(data, dict):
        candidates.append(data)
    for candidate in candidates:
        for key in ("taskId", "task_id", "jobId", "job_id", "id"):
            value = candidate.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _extract_kie_error(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ("msg", "message", "error", "detail"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("msg", "message", "error", "detail"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


async def _create_kie_image_task(prompt: str, image_b64: str, mime_type: str) -> str:
    require_config(KIE_API_KEY, "KIE_API_KEY")
    source_image_url = await _upload_kie_base64_image(image_b64, mime_type)
    payload = {
        "model": KIE_IMAGE_MODEL,
        "input": {
            "prompt": prompt,
            "image_input": [source_image_url],
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
    task_id = _extract_kie_task_id(data)
    if not task_id:
        provider_error = _extract_kie_error(data)
        if provider_error:
            raise HTTPException(status_code=502, detail=f"Image provider error: {provider_error}")
        raise HTTPException(
            status_code=502,
            detail=f"Image provider did not return a task ID. Response: {json.dumps(data)[:500]}",
        )
    return task_id


async def _upload_kie_base64_image(image_b64: str, mime_type: str) -> str:
    require_config(KIE_API_KEY, "KIE_API_KEY")
    extension = mimetypes.guess_extension(mime_type or "") or ".png"
    upload_payload = {
        "base64Data": f"data:{mime_type};base64,{image_b64}",
        "uploadPath": "images/adflow",
        "fileName": f"upload-{uuid.uuid4().hex}{extension}",
    }
    data = await _post_json(
        f"{KIE_UPLOAD_BASE_URL}/api/file-base64-upload",
        headers={
            "Authorization": f"Bearer {KIE_API_KEY}",
            "Content-Type": "application/json",
        },
        payload=upload_payload,
        timeout=60,
    )
    file_data = (data or {}).get("data") or {}
    download_url = file_data.get("downloadUrl") or file_data.get("fileUrl")
    if not download_url:
        raise HTTPException(
            status_code=502,
            detail=f"Image upload provider did not return a file URL. Response: {json.dumps(data)[:500]}",
        )
    return download_url


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


class MetaConnectionSelectionIn(BaseModel):
    page_id: str


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


# -------------------- Social Connections --------------------
@api_router.get("/social/connections")
async def list_connections(user=Depends(get_current_user)):
    rows = await db.social_connections.find(
        {"user_id": user["id"]},
        {"_id": 0, "access_token": 0},
    ).to_list(100)
    return rows


@api_router.get("/social/meta/start")
async def start_meta_connect(platform: Literal["instagram", "facebook"], app_redirect_uri: Optional[str] = None, user=Depends(get_current_user)):
    require_config(META_APP_ID, "META_APP_ID")
    require_config(META_APP_SECRET, "META_APP_SECRET")
    require_config(META_REDIRECT_URI, "META_REDIRECT_URI")

    state = uuid.uuid4().hex
    app_redirect = (app_redirect_uri or META_APP_REDIRECT_URI).strip() or META_APP_REDIRECT_URI
    await db.oauth_states.insert_one(
        {
            "id": str(uuid.uuid4()),
            "state": state,
            "user_id": user["id"],
            "platform": platform,
            "app_redirect_uri": app_redirect,
            "created_at": now_iso(),
            "expires_at": (utcnow() + timedelta(minutes=15)).isoformat(),
        }
    )
    scopes = [
        "public_profile",
        "email",
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "instagram_basic",
        "instagram_content_publish",
        "business_management",
    ]
    auth_url = f"{META_OAUTH_BASE_URL}/dialog/oauth?" + urlencode(
        {
            "client_id": META_APP_ID,
            "redirect_uri": META_REDIRECT_URI,
            "scope": ",".join(scopes),
            "response_type": "code",
            "state": state,
        }
    )
    return {"auth_url": auth_url}


@api_router.get("/oauth/meta/callback")
async def meta_oauth_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None, error_message: Optional[str] = None):
    state_doc = await db.oauth_states.find_one({"state": state}) if state else None
    app_redirect = (state_doc or {}).get("app_redirect_uri") or META_APP_REDIRECT_URI

    if error:
        message = error_message or error
        return _meta_redirect_with_status(app_redirect, status_value="error", message=message)

    if not state_doc:
        return HTMLResponse("<h1>Meta connection failed</h1><p>OAuth state expired or was invalid.</p>", status_code=400)
    if not code:
        await db.oauth_states.delete_one({"state": state})
        return _meta_redirect_with_status(app_redirect, status_value="error", message="Missing authorization code")

    try:
        access_token = await _exchange_meta_code_for_user_token(code)
        profile = await _meta_get("/me", access_token=access_token, params={"fields": "id,name,email"})
        pages = await _meta_get("/me/accounts", access_token=access_token, params={"fields": "id,name,access_token"})
        page_rows = pages.get("data", []) if isinstance(pages, dict) else []
        page_options = []
        for facebook_page in page_rows:
            page_token = facebook_page.get("access_token") or access_token
            page_detail = await _meta_get(
                f"/{facebook_page['id']}",
                access_token=page_token,
                params={"fields": "id,name,instagram_business_account{id,username,name}"},
            )
            instagram_account = page_detail.get("instagram_business_account")
            page_options.append(
                {
                    "page_id": facebook_page["id"],
                    "page_name": facebook_page.get("name") or "Facebook Page",
                    "page_access_token": page_token,
                    "instagram_account": instagram_account,
                }
            )

        requested_platform = state_doc.get("platform", "facebook")
        eligible_options = [
            option for option in page_options
            if requested_platform != "instagram" or option.get("instagram_account")
        ]

        if not eligible_options:
            raise HTTPException(
                status_code=400,
                detail="Meta login succeeded, but no eligible Facebook Page or linked Instagram business account was found.",
            )

        if len(eligible_options) == 1:
            connected_platforms = await _store_meta_connection_for_page(
                user_id=state_doc["user_id"],
                profile=profile,
                page_option=eligible_options[0],
                requested_platform=requested_platform,
                access_token=access_token,
            )
            await db.oauth_states.delete_one({"state": state})
            return _meta_redirect_with_status(
                app_redirect,
                status_value="success",
                message="Connected successfully",
                platforms=",".join(connected_platforms),
            )

        selection_id = str(uuid.uuid4())
        await db.meta_connection_options.insert_one(
            {
                "id": selection_id,
                "user_id": state_doc["user_id"],
                "requested_platform": requested_platform,
                "profile": {
                    "id": profile.get("id"),
                    "name": profile.get("name"),
                    "email": profile.get("email"),
                },
                "access_token": access_token,
                "options": eligible_options,
                "created_at": now_iso(),
                "expires_at": (utcnow() + timedelta(minutes=30)).isoformat(),
            }
        )
        await db.oauth_states.delete_one({"state": state})
        return _meta_redirect_with_status(
            app_redirect,
            status_value="select",
            message="Choose which account to connect",
            platforms=requested_platform,
            extra={"selection_id": selection_id},
        )
    except HTTPException as exc:
        await db.oauth_states.delete_one({"state": state})
        return _meta_redirect_with_status(app_redirect, status_value="error", message=str(exc.detail))
    except Exception as exc:
        logger.exception("Meta OAuth callback failed")
        await db.oauth_states.delete_one({"state": state})
        return _meta_redirect_with_status(app_redirect, status_value="error", message=f"Meta connection failed: {exc}")


@api_router.post("/social/connections")
async def connect_social(data: SocialConnectIn, user=Depends(get_current_user)):
    if data.platform in {"instagram", "facebook"}:
        raise HTTPException(
            status_code=400,
            detail="Instagram and Facebook now use Meta OAuth. Start the connection from the connect screen.",
        )
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


@api_router.get("/social/meta/options/{selection_id}")
async def get_meta_connection_options(selection_id: str, user=Depends(get_current_user)):
    doc = await db.meta_connection_options.find_one(
        {"id": selection_id, "user_id": user["id"]},
        {"_id": 0, "id": 1, "requested_platform": 1, "options": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Meta account selection expired or was not found.")

    cleaned_options = []
    for option in doc.get("options", []):
        cleaned_options.append(
            {
                "page_id": option["page_id"],
                "page_name": option.get("page_name") or "Facebook Page",
                "instagram_account": option.get("instagram_account"),
            }
        )

    return {
        "id": doc["id"],
        "requested_platform": doc.get("requested_platform", "facebook"),
        "options": cleaned_options,
    }


@api_router.post("/social/meta/options/{selection_id}/select")
async def select_meta_connection_option(selection_id: str, data: MetaConnectionSelectionIn, user=Depends(get_current_user)):
    doc = await db.meta_connection_options.find_one({"id": selection_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Meta account selection expired or was not found.")

    option = next((item for item in doc.get("options", []) if item.get("page_id") == data.page_id), None)
    if not option:
        raise HTTPException(status_code=404, detail="The selected Meta account was not found.")

    connected_platforms = await _store_meta_connection_for_page(
        user_id=user["id"],
        profile=doc.get("profile", {}),
        page_option=option,
        requested_platform=doc.get("requested_platform", "facebook"),
        access_token=doc.get("access_token", ""),
    )
    await db.meta_connection_options.delete_one({"id": selection_id})
    return {"status": "connected", "platforms": connected_platforms}


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
    image_bytes = base64.b64decode(data.image_base64)
    upload_key = f"uploads/{user['id']}/{upload_id}.{(mimetypes.guess_extension(data.mime_type) or '.jpg').lstrip('.')}"
    stored = await _upload_bytes_to_r2(image_bytes, upload_key, data.mime_type)
    doc = {
        "id": upload_id,
        "user_id": user["id"],
        "mime_type": data.mime_type,
        "storage_key": stored["key"],
        "created_at": now_iso(),
    }
    await db.uploaded_images.insert_one(doc.copy())
    return {
        "id": upload_id,
        "mime_type": data.mime_type,
        "data_uri": stored["url"],
        "created_at": doc["created_at"],
    }


# -------------------- Image generation --------------------
DAILY_IMAGE_GEN_LIMIT = int(os.environ.get("DAILY_IMAGE_GEN_LIMIT", "10"))


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


def _default_ad_brief(tone: str, post_goal: str) -> str:
    tone_map = {
        "friendly": "approachable and inviting",
        "playful": "energetic and fun",
        "bold": "confident and high-impact",
        "luxury": "premium and aspirational",
    }
    goal_map = {
        "promotion": "highlight an offer and make the product feel irresistible",
        "new_launch": "make the item feel new, elevated, and worthy of attention",
        "engagement": "look scroll-stopping and social-first so people want to react",
        "general_brand_post": "present the product as a flagship brand campaign visual",
    }
    tone_phrase = tone_map.get((tone or "").strip().lower(), "premium and inviting")
    goal_phrase = goal_map.get((post_goal or "").strip().lower(), "present the product as a flagship brand campaign visual")
    return (
        f"Create the strongest possible high-clarity ad image for this product. Make it feel {tone_phrase}. "
        f"The creative goal is to {goal_phrase}. Use premium commercial composition, sharp hero focus, "
        f"beautiful lighting, refined background design, and a polished campaign-ready finish."
    )


def _compose_ad_generation_prompt(prompt: str, tone: str, post_goal: str, variation_text: str) -> tuple[str, str]:
    user_prompt = (prompt or "").strip() or _default_ad_brief(tone, post_goal)
    enhanced_style_direction = (
        "AdFlow signature campaign direction: make this feel like a premium paid-social ad with crystal-clear hero detail, "
        "designed lighting, stronger depth, refined set styling, rich contrast, luxurious polish, and tasteful negative space "
        "that could hold ad copy later."
    )
    system_msg = (
        "You are a world-class product photographer, commercial retoucher, and ad art director. "
        "When given a reference product photo, create the strongest possible paid-social campaign image. "
        "The result must feel premium, intentionally designed, and ad-ready, with high clarity, strong subject separation, "
        "beautiful lighting, and a polished brand look. Keep the hero product clearly recognizable and undistorted. "
        "Avoid defaulting to an autumn palette, warm fall props, or seasonal harvest scenery unless the user explicitly asks for that mood. "
        "Do not add text or logos."
    )
    full_prompt = (
        f"Using this uploaded product/subject image as the hero, create a polished marketing ad photo.\n\n"
        f"USER REQUEST: {user_prompt}\n"
        f"TONE: {tone}\n"
        f"POST GOAL: {post_goal}\n\n"
        f"{enhanced_style_direction}\n"
        f"{variation_text}\n\n"
        f"Art direction requirements:\n"
        f"- Make it look like a premium ad campaign, not a basic product picture\n"
        f"- Push clarity, texture detail, lighting quality, and visual hierarchy\n"
        f"- Use a designed environment or studio setup with stronger composition\n"
        f"- Add depth, contrast, refinement, and campaign-level polish\n"
        f"- Build scenery that makes sense for the product, for example ingredients around food or bakery items when appropriate\n"
        f"- Leave tasteful breathing room that could support copy placement later\n\n"
        f"Critical rules:\n"
        f"- The original subject must remain clearly recognizable and un-distorted\n"
        f"- No text, no words, no logos in the image\n"
        f"- Clean composition, the subject is the hero\n"
        f"- Realistic, high-end commercial quality with campaign-level finish\n"
        f"- No watermarks"
    )
    return system_msg, full_prompt


async def _generate_single_ad_image(image_b64: str, mime_type: str, prompt: str, tone: str,
                                     post_goal: str, variation_text: str, idx: int) -> Optional[dict]:
    """Call OpenAI image edit and return {data, mime_type} or None."""
    system_msg, full_prompt = _compose_ad_generation_prompt(prompt, tone, post_goal, variation_text)
    try:
        require_config(OPENAI_API_KEY, "OPENAI_API_KEY")
        image_bytes = base64.b64decode(image_b64)
        extension = mimetypes.guess_extension(mime_type or "") or ".png"
        response = await _post_multipart(
            f"{OPENAI_API_BASE_URL}/images/edits",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            data={
                "model": OPENAI_IMAGE_MODEL,
                "prompt": f"{system_msg}\n\n{full_prompt}",
                "size": OPENAI_IMAGE_SIZE,
                "quality": OPENAI_IMAGE_QUALITY,
                "n": "1",
            },
            files=[
                (
                    "image[]",
                    (f"source{extension}", image_bytes, mime_type or "image/png"),
                )
            ],
            timeout=180,
        )
        image_data = None
        if isinstance(response, dict):
            for item in response.get("data", []):
                b64_json = item.get("b64_json")
                if isinstance(b64_json, str) and b64_json.strip():
                    image_data = b64_json
                    break
        if not image_data:
            raise HTTPException(status_code=502, detail="OpenAI image provider did not return image data.")
        return {"data": image_data, "mime_type": "image/png", "provider": "openai", "style_name": "OpenAI Campaign Cut"}
    except Exception as e:
        logger.exception(f"Image gen variation {idx} failed: {e}")
    return None


async def _generate_kie_ad_image(image_b64: str, mime_type: str, prompt: str, tone: str,
                                 post_goal: str, variation_text: str, idx: int) -> Optional[dict]:
    """Call KIE / Nano Banana and return {data, mime_type} or None."""
    if not KIE_API_KEY:
        return None
    system_msg, full_prompt = _compose_ad_generation_prompt(prompt, tone, post_goal, variation_text)
    try:
        task_id = await _create_kie_image_task(f"{system_msg}\n\n{full_prompt}", image_b64, mime_type)
        image_data, result_mime_type = await _wait_for_kie_image(task_id)
        return {"data": image_data, "mime_type": result_mime_type, "provider": "kie", "style_name": "Premium Scene Cut"}
    except Exception as e:
        logger.exception(f"KIE image gen variation {idx} failed: {e}")
    return None


@api_router.post("/generate/images")
async def generate_images(data: GenerateImagesIn, user=Depends(get_current_user)):
    upload = await db.uploaded_images.find_one({"id": data.uploaded_image_id, "user_id": user["id"]})
    if not upload:
        raise HTTPException(status_code=404, detail="Uploaded image not found")
    upload_bytes, upload_mime_type = await _ensure_uploaded_image_in_r2(upload)
    upload_b64 = base64.b64encode(upload_bytes).decode("utf-8")

    used_today = await _count_today_requests(user["id"])
    req_doc = None
    if DAILY_IMAGE_GEN_LIMIT > 0:
        # Enforce daily rate limit (per user, UTC day) BEFORE spending AI credits
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

    tasks = [
        _generate_single_ad_image(
            upload_b64,
            upload_mime_type,
            data.prompt,
            data.tone or "friendly",
            data.post_goal or "general brand post",
            "Provider brief: create a clean, premium ad image with strong clarity and a smart product-first scene.",
            0,
        ),
        _generate_kie_ad_image(
            upload_b64,
            upload_mime_type,
            data.prompt,
            data.tone or "friendly",
            data.post_goal or "general brand post",
            "Provider brief: create a richer, more inventive ad scene with stronger environmental storytelling and premium commercial styling.",
            1,
        ),
    ]
    results = await asyncio.gather(*tasks, return_exceptions=False)

    generated = []
    provider_warnings = []
    for i, res in enumerate(results):
        if res is None:
            if i == 1:
                provider_warnings.append("The premium image provider was unavailable for this request, so only the OpenAI image is shown.")
            continue
        gen_id = str(uuid.uuid4())
        generated_key = f"generated/{user['id']}/{gen_id}.{(mimetypes.guess_extension(res['mime_type']) or '.png').lstrip('.')}"
        generated_bytes = base64.b64decode(res["data"])
        stored = await _upload_bytes_to_r2(generated_bytes, generated_key, res["mime_type"])
        doc = {
            "id": gen_id,
            "uploaded_image_id": data.uploaded_image_id,
            "user_id": user["id"],
            "mime_type": res["mime_type"],
            "storage_key": stored["key"],
            "generation_prompt": data.prompt,
            "variation_index": i,
            "style_name": res.get("style_name") or f"Option {i + 1}",
            "provider": res.get("provider", "unknown"),
            "created_at": now_iso(),
            "is_selected": False,
        }
        await db.generated_images.insert_one(doc.copy())
        generated.append({
            "id": gen_id,
            "variation_index": i,
            "style_name": doc["style_name"],
            "provider": doc["provider"],
            "data_uri": stored["url"],
        })

    if not generated:
        # Refund the quota if the entire batch failed (nothing usable produced)
        if req_doc:
            await db.generation_requests.delete_one({"id": req_doc["id"]})
        raise HTTPException(status_code=502, detail="We couldn't generate your ad images right now. Please try again.")
    return {
        "images": generated,
        "usage": {
            "used_today": used_today + (1 if req_doc else 0),
            "limit": DAILY_IMAGE_GEN_LIMIT,
            "remaining": None if DAILY_IMAGE_GEN_LIMIT <= 0 else max(0, DAILY_IMAGE_GEN_LIMIT - (used_today + 1)),
        },
        "warnings": provider_warnings,
    }


@api_router.get("/usage/today")
async def usage_today(user=Depends(get_current_user)):
    used = await _count_today_requests(user["id"])
    return {
        "used_today": used,
        "limit": DAILY_IMAGE_GEN_LIMIT,
        "remaining": None if DAILY_IMAGE_GEN_LIMIT <= 0 else max(0, DAILY_IMAGE_GEN_LIMIT - used),
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
    gen_img_bytes, gen_img_mime_type = await _ensure_generated_image_in_r2(gen_img)
    gen_img_b64 = base64.b64encode(gen_img_bytes).decode("utf-8")
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
            gen_img_b64,
            gen_img_mime_type,
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
    connections_by_platform = {
        c["platform"]: c for c in connections if c.get("status") == "connected"
    }
    connected_platforms = set(connections_by_platform.keys())

    # Mark as selected
    await db.generated_images.update_one({"id": gen_img["id"]}, {"$set": {"is_selected": True}})
    await db.generated_captions.update_one({"id": gen_cap["id"]}, {"$set": {"is_selected": True}})

    post_id = str(uuid.uuid4())
    now = now_iso()
    scheduled = data.schedule_for
    publish_status = "scheduled" if scheduled else "published"
    published_at = None if scheduled else now

    warnings = []
    await _ensure_generated_image_in_r2(gen_img)
    image_url = await _signed_r2_url(gen_img["storage_key"])
    hashtag_text = " ".join(gen_cap.get("hashtags", []))
    caption_parts = [gen_cap.get("caption_text", "").strip(), gen_cap.get("cta", "").strip(), hashtag_text.strip()]
    publish_caption = "\n\n".join(part for part in caption_parts if part)

    ig_post_id = None
    fb_post_id = None
    tt_post_id = None

    if data.instagram_enabled and "instagram" not in connected_platforms:
        warnings.append("Instagram account is not connected — this post was saved but not actually sent.")
    if data.facebook_enabled and "facebook" not in connected_platforms:
        warnings.append("Facebook account is not connected — this post was saved but not actually sent.")
    if data.tiktok_enabled and "tiktok" not in connected_platforms:
        warnings.append("TikTok account is not connected — this post was saved but not actually sent.")

    if not scheduled and data.facebook_enabled and "facebook" in connected_platforms:
        fb_conn = connections_by_platform["facebook"]
        try:
            fb_post_id = await _publish_facebook_photo(
                page_id=fb_conn["account_id"],
                access_token=fb_conn["access_token"],
                image_url=image_url,
                caption_text=publish_caption,
            )
        except HTTPException as exc:
            warnings.append(f"Facebook publish failed: {exc.detail}")
            publish_status = "partial_failure" if not scheduled else publish_status

    if not scheduled and data.instagram_enabled and "instagram" in connected_platforms:
        ig_conn = connections_by_platform["instagram"]
        try:
            ig_post_id = await _publish_instagram_photo(
                instagram_account_id=ig_conn["account_id"],
                access_token=ig_conn["access_token"],
                image_url=image_url,
                caption_text=publish_caption,
            )
        except HTTPException as exc:
            warnings.append(f"Instagram publish failed: {exc.detail}")
            publish_status = "partial_failure" if not scheduled else publish_status

    if not scheduled and data.tiktok_enabled and "tiktok" in connected_platforms:
        tt_post_id = f"mock_tt_{uuid.uuid4().hex[:10]}"
        warnings.append("TikTok publishing is still mocked while the direct integration is in progress.")

    if not scheduled:
        attempted_live_platforms = [
            platform
            for platform, enabled in (
                ("instagram", data.instagram_enabled),
                ("facebook", data.facebook_enabled),
                ("tiktok", data.tiktok_enabled),
            )
            if enabled and platform in connected_platforms
        ]
        successful_live_platforms = [
            platform
            for platform, post_identifier in (
                ("instagram", ig_post_id),
                ("facebook", fb_post_id),
                ("tiktok", None),
            )
            if post_identifier
        ]
        if attempted_live_platforms and not successful_live_platforms:
            publish_status = "failed"
            published_at = None
        elif warnings and successful_live_platforms:
            publish_status = "partial_failure"

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
        {"_id": 0, "storage_key": 1, "image_base64": 1, "mime_type": 1, "style_name": 1, "generation_prompt": 1, "user_id": 1, "id": 1},
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
        await _ensure_generated_image_in_r2(gi)
        out["image_data_uri"] = await _signed_r2_url(gi["storage_key"])
        out["image_style"] = gi.get("style_name")
        out["generation_prompt"] = gi.get("generation_prompt", "")
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
    recent_hydrated = None

    if posts:
        recent_hydrated = await _hydrate_post(posts[0])

    return {
        "total_posts": total_posts,
        "published_count": len(published_posts),
        "most_recent": recent_hydrated,
    }


# -------------------- Health --------------------
@api_router.get("/")
async def root():
    return {"app": "AdFlow", "status": "ok", "time": now_iso()}


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
