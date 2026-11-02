# Database design

Promptly uses SQLite with foreign keys enabled. The local database file defaults to `data/promptly.sqlite`. Set `DB_PATH` to override the location. If this project folder is synchronized by OneDrive, run one local server at a time so two SQLite writers do not compete for the same file.

```mermaid
erDiagram
  USERS ||--o{ SESSIONS : owns
  USERS ||--o{ PROMPTS : saves
  USERS ||--o| USER_AVATARS : has
  PROMPTS ||--|{ PROMPT_VERSIONS : has
  PROMPTS ||--o{ PROMPT_RUNS : produces
  PROMPT_VERSIONS o|--o{ PROMPT_RUNS : used_by

  USERS {
    integer id PK
    text name
    text email UK
    text password_hash
    text created_at
  }
  SESSIONS {
    text token_hash PK
    integer user_id FK
    text expires_at
    text created_at
  }
  USER_AVATARS {
    integer user_id PK, FK
    text mime_type
    blob image_data
    text updated_at
  }
  PROMPTS {
    integer id PK
    integer user_id FK
    text title
    text mode
    text task
    text current_text
    text created_at
    text updated_at
  }
  PROMPT_VERSIONS {
    integer id PK
    integer prompt_id FK
    integer version_number
    text content
    text created_at
  }
  PROMPT_RUNS {
    integer id PK
    integer prompt_id FK
    integer version_id FK
    text model
    text response_text
    text created_at
  }
```

## Relationships and rules

- A user owns many prompts and sessions. Deleting a user cascades to their sessions and prompts.
- Each user can store one optional profile photo; accounts without one display the first letter of their name.
- A prompt belongs to one user. Every content edit creates a new, numbered prompt version.
- An AI run records the model response and references the version that was executed. Removing a version does not erase its run record; the reference becomes null.
- Prompt reads and writes include the authenticated user ID in their database query. Knowing another prompt's numeric ID does not grant access.
- Passwords are stored only as scrypt hashes. Session tokens are random, returned in HTTP-only cookies, and stored in SQLite as SHA-256 hashes.

## Storage lifecycle

Tables and indexes are created automatically at server startup. The default database path is `./data/promptly.sqlite`. SQLite WAL files are created beside the database while it is in use; stop the app before copying the database for a manual backup.
