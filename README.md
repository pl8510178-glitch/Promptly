# Promptly

Promptly is a full-stack prompt workspace for learning, software development, and image-editing prompts. Create an account, build prompts with AI, save them privately, and keep a version history.

## Stack

- Frontend: responsive HTML, CSS, and browser JavaScript.
- Backend: Node.js HTTP server and JSON REST API.
- Database: SQLite through Node's built-in `node:sqlite` module. No external database account or npm packages are required.
- Authentication: scrypt password hashing, random session tokens stored as hashes, and HTTP-only `SameSite=Lax` cookies.
- AI: Gemini or OpenAI, called only from the backend. The provider key never goes to the browser.

Node.js 22.13.0 or newer is required for the built-in SQLite module.

## Start locally

1. Copy `.env.example` to `.env` if you have not already configured it.
2. The default setup is Gemini 3.1 Flash-Lite: set `AI_PROVIDER=gemini`, add your Gemini key to `GEMINI_API_KEY`, and use `GEMINI_MODEL=gemini-3.1-flash-lite`. Google lists a free API tier for this model, subject to project limits. Its free-tier prompts may be used to improve Google products. To use OpenAI instead, set `AI_PROVIDER=openai` and configure `OPENAI_API_KEY`/`OPENAI_MODEL`.
3. Keep provider keys in `.env`; do not paste them into browser code or commit them.
4. Run `npm start` in this folder.
5. Open http://localhost:3000.
6. Register your Promptly account. Prompts are private to that account.

ChatGPT subscriptions and OpenAI API usage have separate billing. Promptly uses model APIs; a ChatGPT login or subscription does not supply an API key.

The default database is created at `data/promptly.sqlite` and is excluded from Git. You can set `DB_PATH` to choose another location. Since this project is inside OneDrive, run one local server at a time so two SQLite writers do not compete for the same file. For Docker Compose, use `docker compose up --build`; the database persists in the named `promptly_data` volume.

## Features

- Account registration, sign-in, sign-out, private user-owned data.
- Guided learning, software development, and image-editing prompt flows.
- Profile photo upload with a name-initial fallback.
- AI prompt generation and prompt execution.
- Saved prompt CRUD: create, search, read, edit, and delete.
- Automatic prompt version history and restore.
- Saved AI runs linked to the prompt version used, with run history.
- Dashboard counts for prompts, versions, and runs.
- Input validation, per-account data isolation, request-origin checks, and sign-in rate limiting.

The image workflow turns a written change request into a prompt for use in an image editor. It does not upload, inspect, or modify the image itself. Profile photos are stored privately in the local SQLite database and are scoped to the signed-in account.

## Database model

See [docs/DATABASE.md](docs/DATABASE.md) for the ER diagram, relationships, and storage notes. The REST endpoint list is in [docs/API.md](docs/API.md).

## API overview

- `GET /api/health` — application and configuration status.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` — account/session lifecycle.
- `GET /api/session` — current signed-in user.
- `GET/POST /api/prompts`, `GET/PUT/DELETE /api/prompts/:id` — private prompt library CRUD.
- `GET/POST /api/prompts/:id/versions`, `POST /api/prompts/:id/versions/:versionId` — inspect and restore versions.
- `POST /api/prompts/:id/runs`, `DELETE /api/prompts/:id/runs/:runId` — save an AI run or remove one.
- `POST /api/questions`, `POST /api/prompt` — guided intake and AI prompt generation.
- `GET/PUT/DELETE /api/profile/avatar` — retrieve, set, or remove the signed-in user's profile photo.

## Course-project notes

The app is ready to demonstrate the client, API, database, authentication, data validation, CRUD, and external AI integration. For a public production launch, add email verification, password reset, HTTPS, database backups, and a managed database with deployment-specific persistent storage. The built-in SQLite setup is intended for this local course MVP and a single app instance.

