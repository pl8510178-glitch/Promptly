# REST API

All routes are same-origin JSON endpoints. Except for health, account/session bootstrap, and sign-in/register/logout, routes require a valid Promptly session cookie. Responses use JSON; errors have an `error` field. The backend checks the request origin on state-changing routes. Prompt workspaces are `study`, `code`, and `image`.

## Account and session

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | App version, database type, and whether AI is configured |
| GET | `/api/session` | Return the current user or `null` |
| POST | `/api/auth/register` | Create an account (`name`, `email`, `password`) and sign in |
| POST | `/api/auth/login` | Sign in (`email`, `password`) |
| POST | `/api/auth/logout` | Revoke the current session |

Passwords must be 10–128 characters. Sessions expire after 14 days. Authentication endpoints are rate limited per client address.

## Prompt workflow

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/questions` | Get guided intake fields (`mode`, `task`) |
| POST | `/api/prompt` | Use the model to shape an intake (`mode`, `task`, `answers`) |
| GET | `/api/prompts?q=term` | Search the signed-in user's prompt library |
| POST | `/api/prompts` | Save a prompt (`title`, `mode`, `task`, `content`) |
| GET | `/api/prompts/:id` | Read a prompt, versions, and latest runs |
| PUT | `/api/prompts/:id` | Update title/content; content changes append a version |
| DELETE | `/api/prompts/:id` | Delete a prompt and its related versions/runs |
| GET | `/api/prompts/:id/versions` | List prompt versions |
| POST | `/api/prompts/:id/versions/:versionId` | Restore a version as a new latest version |
| POST | `/api/prompts/:id/runs` | Run the current prompt and persist the response |
| DELETE | `/api/prompts/:id/runs/:runId` | Delete one saved run |

## Profile photo

Profile photo routes require a signed-in account. Photos are stored as account-owned BLOB data. Supported types are JPEG, PNG, and WebP, up to 2 MB after browser-side resizing.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/profile/avatar` | Return the signed-in user's profile photo (404 when unset) |
| PUT | `/api/profile/avatar` | Save a base64 data URL in `image` |
| DELETE | `/api/profile/avatar` | Remove the saved profile photo |

Users without an uploaded photo display the first letter of their account name.

Prompt text is limited to 20,000 characters and titles to 120 characters. IDs are scoped to the signed-in owner for every read, update, delete, restore, and run operation.
