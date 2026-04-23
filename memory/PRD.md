# AutoSocial AI — Product Requirements (MVP V1)

## What it is
A mobile app (Expo React Native) that helps non-technical small-business owners turn a single product/food/service photo into a polished social-media ad post. User uploads a photo, describes the vibe in plain English, AI generates 3 ad-image variations and 3 caption styles, user picks one of each, confirms, and publishes to Instagram / optionally Facebook. A simple performance dashboard shows reach and likes per post.

## Tech Stack
- Frontend: Expo Router (React Native 0.81, Expo SDK 54), TypeScript
- Backend: FastAPI + Motor (MongoDB)
- AI: Nano Banana 2 via direct KIE API for image generation, and a direct OpenAI-compatible responses API for captions
- Auth: JWT (bcrypt hashed password), AsyncStorage on client
- Social publishing: Mocked (stores post records + fake platform IDs + seeded metrics) — real Meta Graph API can be swapped in later

## Core flows
1. Landing → Sign up / Sign in (email + password)
2. Onboarding (business name, type, tone, optional description/topics)
3. Dashboard (large "Create a post" CTA, metric cards, recent posts, friendly summary)
4. Create Post Wizard (5 steps, progress bar):
   - Step 1: Upload photo (camera / gallery) → base64 to `/api/uploads`
   - Step 2: Describe post (free-text + suggestion chips + goal + tone)
   - Step 3: Generate 3 ad images (parallel Gemini calls, loader stages)
   - Step 4: Generate 3 captions (GPT-5.2, 3 styles)
   - Step 5: Review & Publish (platform toggles, big confirm, result modal)
5. Connect accounts (simulated Instagram / Facebook connection cards)

## Data model (MongoDB collections)
- users, businesses, social_connections, uploaded_images, generated_images, generated_captions, posts, post_metrics, job_logs

## Key rules
- Never auto-post — user must tap "Post now"
- Every AI failure shown in friendly plain English with a retry
- Only selected image/caption flagged `is_selected=true` post-publish
- Metrics seeded on mock publish so the dashboard is alive immediately

## Business enhancement
Dashboard surfaces "best performing post" + weekly reach totals to nudge repeat creation → higher posting frequency = more direct-to-customer reach = higher per-seat lifetime value for the platform.
