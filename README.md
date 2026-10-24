# Festivo AI — Celebration & Event Planner

A GenAI-powered planning assistant that turns event details into a personalized
celebration plan: a budget that adds up, a date-based preparation timeline, a
vendor checklist, and ideas matched to the user's preferences.

Built to [`spec.md`](./spec.md), which is the single source of truth for this
project. Section references like `§9.3` throughout the code and this document
point back to it.

```
Event details → GenAI planning → Output validation → Budget verification
              → Interactive plan dashboard → Task tracking
```

---

## 1. What it does

Supports the three event categories from the challenge — **Wedding**,
**Birthday**, and **Community Event** — and produces four required outputs for
each:

| Output | Behaviour |
| --- | --- |
| **Budget breakdown** | Category-wise estimates, an emergency reserve shown separately from planned spending, and totals recomputed in application code |
| **Timeline** | Preparation tasks counted back from the event date, sorted chronologically, with overdue and follow-up tasks flagged |
| **Vendor checklist** | Event-appropriate services to arrange, grouped by category, with live progress tracking |
| **Personalized ideas** | Suggestions grouped by theme, budget, food, entertainment, guest experience, and budget-saving alternatives |

Plus assumptions, warnings, and an explicit estimates disclaimer on every plan.

### Deliberate non-goals (§5.3)

The app generates **planning suggestions, not commercial arrangements**. A
checklist item does not mean a vendor was contacted, booked, or price-checked,
and every amount is labelled an estimate rather than a quotation.

---

## 2. Architecture

```
USER
 │
 ▼
REACT FRONTEND  (Vite · Tailwind v4 · Lucide · Recharts)
 │  POST /api/events/generate-plan
 ▼
FASTAPI BACKEND
 │
 ├── Input validation (Pydantic)        ← before any paid model call
 ├── Prompt construction               ← §13.4
 ├── Gemini call (structured JSON)     ← key never leaves the backend
 ├── Output validation + date checks   ← §10.3
 ├── Budget arithmetic                 ← §9, computed in Python, never by the model
 └── Constraint checks → one repair round-trip if needed
 │
 ▼
EVENT PLAN DASHBOARD  →  optional save to Postgres
```

### Why the budget is computed twice

The model proposes category amounts; it never decides the totals. `app/services/budget.py`
re-derives every figure with `Decimal` arithmetic:

```
B = total user budget   P = planned expenditure (non-reserve categories)
R = emergency reserve   U = B - P - R        valid when P + R <= B
```

If the model overspends, non-reserve categories are scaled proportionally until
they fit `B`, rounding residue is applied deterministically to the largest
category so the total is exact, and the user is told it happened. **The user's
budget `B` is never silently changed** (§9.5).

---

## 3. Project layout

```
FestiveAI/
├── spec.md                       # Single source of truth
├── backend/
│   ├── app/
│   │   ├── main.py               # App factory, CORS, lifespan
│   │   ├── config.py             # Env-driven settings
│   │   ├── errors.py            # §15.7 error envelope
│   │   ├── schemas.py            # §8 I/O contract (input · raw AI · validated output)
│   │   ├── models.py             # §16 ORM models
│   │   ├── db.py                 # Engine/session, Supabase pooler handling
│   │   ├── routers/
│   │   │   ├── health.py         # §15.1
│   │   │   └── events.py         # §15.2–15.6
│   │   └── services/
│   │       ├── prompt.py         # §13.4 prompt + Gemini response schema
│   │       ├── gemini.py         # Provider client, §13.5 error mapping
│   │       ├── budget.py         # §9 budget engine
│   │       ├── timeline.py       # §10 timeline engine
│   │       ├── planner.py        # §13.3 pipeline orchestration
│   │       └── storage.py        # Persistence + re-derived totals
│   └── tests/                    # 110 tests covering §20
└── frontend/
    └── src/
        ├── components/           # Navbar, EventForm, BudgetOverview, …
        ├── pages/                # Dashboard, CreateEvent, EventPlanPage, SavedEvents
        ├── services/eventApi.js  # Typed client over the error envelope
        ├── utils/                # budgetValidation, dateValidation, format, exportPlan
        ├── constants/            # Event types, themes, preference chips
        └── context/PlanContext   # Draft plan across routes (session-scoped)
```

---

## 4. Running it locally

### Prerequisites

- Python 3.11+ (developed on 3.14)
- Node 20+ (developed on 24)
- A Gemini API key — free from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt

cp .env.example .env            # then fill in GEMINI_API_KEY
python -m uvicorn app.main:app --reload --port 8000
```

Check it came up correctly:

```bash
curl http://127.0.0.1:8000/api/health
```

```json
{
  "status": "ok",
  "ai": { "provider": "gemini", "model": "gemini-2.5-flash", "configured": true },
  "database": { "backend": "postgresql", "persistence_enabled": true }
}
```

`configured: false` means `GEMINI_API_KEY` is missing — the app still boots and
the UI explains exactly what to add.

### Frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

The dev server proxies `/api` to `http://127.0.0.1:8000`, so no frontend
environment variables are needed for local work.

---

## 5. Configuration

All backend settings come from `backend/.env` (see `.env.example`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | _unset_ | **Required** for plan generation. Stays on the backend. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Any model supporting structured output |
| `DATABASE_URL` | `sqlite:///./festivo.db` | Supabase/Postgres URL, or the SQLite fallback |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Comma-separated allowed browser origins |
| `AI_TIMEOUT_SECONDS` | `90` | Request timeout (§19.5) |
| `AI_MAX_REPAIR_ATTEMPTS` | `1` | Correction round-trips on invalid output |
| `GEMINI_THINKING_BUDGET` | `0` | Thinking tokens; `0` keeps structured output fast and untruncated |
| `AI_TEMPERATURE` | `0.8` | Generation variety |

### Supabase Postgres (connection pooler)

Supabase dashboard → **Project Settings → Database → Connection pooling**, then
paste the string in as-is:

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

`app/db.py` handles the rest:

- **Driver** — Supabase hands out a bare `postgresql://` URL, which SQLAlchemy
  maps to psycopg2. The URL is rewritten to `postgresql+psycopg` (psycopg 3,
  which is what's installed), so no manual editing is needed.
- **Prepared statements** — disabled (`prepare_threshold=None`) on any
  `*.pooler.supabase.com` host, since neither pooler mode supports them.
- **Connection pooling** — transaction mode (port **6543**) additionally uses
  `NullPool`, because a server connection is only yours for the duration of a
  transaction. Session mode (port **5432**) keeps normal pooling with
  `pool_pre_ping`.

Tables are created on startup. Two gotchas worth knowing:

- The pooler username must be **tenant-qualified** — `postgres.<project-ref>`,
  not plain `postgres`. A bare `postgres` fails with
  `password authentication failed`.
- URL-encode the password if it contains `@ : / ? # [ ] !` or similar.

If the database is unreachable the API degrades to generate-only mode instead of
failing to boot: plans still generate, and only saving is disabled.
`GET /api/health` reports `persistence_enabled` and the exception type, with the
full traceback in the server log.

### Write durability

Write endpoints commit **before** the response is returned. FastAPI runs a
`yield` dependency's teardown only after the response is sent, so committing
there would tell the client a write succeeded before it was durable — and a
client reading immediately afterwards could still see the old row. `get_db`
therefore only rolls back and closes; `services/storage.py` commits explicitly.
`test_api.py::test_writes_are_committed_before_the_response` guards this.

---

## 6. API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness plus AI and database status |
| `POST` | `/api/events/generate-plan` | Validate → generate → validate → return a plan |
| `POST` | `/api/events/regenerate-plan` | Same pipeline, with an optional revision note |
| `GET` | `/api/events/overview` | Dashboard statistics from real saved data only |
| `POST` | `/api/events` | Persist an event and its plan |
| `GET` | `/api/events` | List saved events with checklist progress |
| `GET` | `/api/events/{id}` | Fetch one saved plan, totals re-derived on read |
| `DELETE` | `/api/events/{id}` | Delete a saved event and its plan items |
| `PATCH` | `/api/events/{id}/checklist/{item_id}` | Update checklist completion |
| `PATCH` | `/api/events/{id}/timeline/{item_id}` | Update timeline completion |

Interactive docs at `http://127.0.0.1:8000/docs`.

Every failure uses one envelope (§15.7) — no stack traces or provider details
reach the client:

```json
{
  "error": {
    "code": "INVALID_EVENT_INPUT",
    "message": "Please enter a valid budget.",
    "details": [{ "field": "budget", "message": "Input should be greater than 0" }]
  }
}
```

Codes: `INVALID_EVENT_INPUT`, `AI_NOT_CONFIGURED`, `AI_UNAVAILABLE`,
`AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_INVALID_OUTPUT`,
`BUDGET_VALIDATION_FAILED`, `STORAGE_UNAVAILABLE`, `NOT_FOUND`,
`INTERNAL_ERROR`. The frontend maps each to a friendly message plus a retry
action, and always keeps the user's form input.

---

## 7. Testing

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest -q          # 147 tests, no network calls
python -m ruff check app tests
```

```bash
cd frontend
npm install
npm test                     # 138 tests
npm run lint
```

Coverage maps onto §20:

- **`test_budget.py`** — the §9.4 worked example reproduces exactly
  (P ₹12,000 · R ₹3,000 · U ₹0 · ₹500/guest); over-budget rescaling; unallocated
  budget; negative, zero, and unnamed categories; empty expense lists; a reserve
  larger than the budget; very small budgets; rounding residue; money strings
  like `"₹4,500"`; and reserve-vs-expense classification, so that *Emergency
  lighting* stays in planned expenditure instead of being swallowed by the
  reserve
- **`test_timeline.py`** — chronological ordering; invalid dates dropped; tasks
  after the event date clamped; follow-ups allowed past it and sorted last;
  overdue flagging; accelerated schedules; same-day events; multiple date formats
- **`test_schemas.py`** — input validation (negative budgets, zero guests, past
  dates, bad event types, over-long text) and untrusted AI output (missing
  fields, wrong types, placeholder costs)
- **`test_planner.py`** — the full pipeline with a stubbed provider: happy path,
  repair round-trips, persistent failure, local correction of an over-budget
  response, prompt contents, every §13.5 provider failure mode, and that user
  free text is fenced so it cannot be read as an instruction
- **`test_api.py`** — all endpoints, the error envelope, validation happening
  before any model call, the save/list/patch/delete round-trip, that a
  checklist item cannot be patched through another event, that the optional
  requirements survive a save and reopen, and that a reloaded plan shows
  exactly the figures it was generated with
- **`test_middleware.py`** — the body-size cap and the per-client rate limit on
  the generation endpoints, including that cheap endpoints are not limited
- **`test_db_url.py`** — pooler URL normalisation, including that the password
  is never mangled

On the frontend:

- **`tests/utils.test.js`** — budget and guest validation at their boundaries,
  the per-guest advisory, local-calendar date handling, and that no formatter
  can ever render `NaN` to a user
- **`tests/form.test.js(x)`** — every required field reported in one pass,
  the form ⇄ API mapping, and a full round-trip through edit/regenerate
- **`tests/eventApi.test.js`** — every error branch normalised, an unreachable
  backend, a 2xx with an unreadable body, and abort propagation
- **`tests/components.test.jsx`** — checklist grouping and toggling, keyboard
  operation, progress announcements, the error boundary, and that focus is
  never stolen out of a checkbox mid-interaction
- **`tests/focus.test.jsx`** — focus moves to the first invalid field on a
  failed submit, stepping into the radio group rather than at its
  non-focusable container
- **`tests/contrast.test.js`** — parses the real design tokens from
  `index.css` and computes WCAG 2.1 contrast ratios, so a colour change that
  breaks AA fails the build rather than shipping

For a live check against the real Gemini API and the real database, with the
backend running:

```bash
cd backend
python smoke_test.py         # 42 end-to-end assertions
```

Verified manually in the browser: the §22 demo scenario end-to-end, empty and
loading and error states, checklist toggling with undo, save and reload, the
`AI_NOT_CONFIGURED` path, and layout down to a 276px viewport with no horizontal
scrolling.

---

## 8. Demo script (§22)

1. **Dashboard** — welcome section, three category cards, and a real empty state
   (no fabricated statistics before anything is saved).
2. **Create an event** — select *Birthday*, then: budget ₹15,000 · 30 guests ·
   15 November 2026 · Bhopal · *Elegant and pastel*. Try submitting empty first
   to show per-field validation.
3. **Generate** — the loading state blocks duplicate submissions.
4. **Review the budget** — categories, the reserve shown separately from planned
   spending, and a *Totals verified* badge confirming `P + R ≤ B`.
5. **Review the timeline** — tasks grouped by month, counted back from the event
   date, with follow-ups last.
6. **Use the checklist** — tick items and watch progress update immediately;
   untick to confirm undo works.
7. **Explore ideas** — pastel decor, budget-friendly alternatives, guest
   experience ideas sized for 30 guests.
8. **Show adaptability** — *Edit Event Details*, change to 80 guests and
   ₹60,000, regenerate. The plan restructures: venue and catering dominate and
   photography appears, still summing exactly to the new budget.

Optionally: *Save Plan* → **My Events** → reopen to show persisted checklist
progress, and *Download Plan* for a print/PDF export.

---

## 9. Security and privacy

- The Gemini API key lives only in backend environment variables and never
  reaches the browser (§19.1). `.env` is gitignored; `.env.example` is the
  committed template.
- Input is validated before any model call, so invalid requests cost nothing
  (§19.5). Requests are timeout-bounded, request bodies are size-capped, and the
  two generation endpoints are rate limited per client IP (10 per minute by
  default) — those are the only calls that cost money at the provider.
- Every piece of user free text is fenced inside `<<< >>>` markers before it
  reaches the model, and the system instruction tells the model to treat a
  fenced region as information rather than instructions. The schema and the
  budget recomputation would survive an injection anyway, but the §19 safety
  rules — no invented vendors, no implied quotations — exist only at the prompt
  level, which is exactly what such an attempt targets.
- Model output is treated as untrusted data: amounts are coerced and floored,
  dates re-parsed, priorities normalized, and all text is escaped in the PDF
  export. No generated HTML or script is ever executed (§19.4).
- Every `*Out` field is length- and count-bounded. These models double as the
  save request body, so without bounds a caller could persist megabytes per row.
- Errors are logged server-side; clients get a code and a safe message. Every
  failure, including a 404 on an unknown route, uses the same §15.7 envelope.
- Checklist and timeline updates verify the item belongs to the event before
  writing.
- **No authentication.** Saved events are scoped to whatever database the
  backend points at, and the UI says so plainly rather than implying secure
  per-user cloud storage (§7.6). Add authentication and ownership columns before
  exposing this to multiple untrusted users.

---

## 10. Accessibility

Semantic landmarks and headings, a skip link, labelled form controls with
`aria-invalid` and `aria-describedby` wiring, event-type cards as a real
radiogroup, visible focus indicators, `aria-live` status for generation and
checklist progress, status conveyed by text and icon rather than colour alone,
`prefers-reduced-motion` support, and responsive layouts verified down to 276px.

Two decisions worth calling out, because both were bugs first:

- **The plan screen moves focus to its heading when a plan appears**, keyed on
  the plan's *identity* rather than the plan object. Every checklist tick
  produces a new plan object, so keying on the object re-fired the effect on
  each tick and threw focus out of the checkbox the user was working in.
- **A checklist item is never `disabled` while its save is in flight.** A
  disabled control cannot hold focus, so the browser blurred it mid-interaction
  and dropped keyboard users back to the top of the document on every tick. It
  carries `aria-busy` instead; the optimistic update already shows the new
  state, and a failed save rolls it back.

Colour contrast is not checked by eye. `tests/contrast.test.js` parses the real
tokens out of `index.css` and computes WCAG 2.1 relative-luminance ratios,
including alpha compositing for layered washes, asserting 4.5:1 for body text
and 3:1 for large text and non-text UI boundaries (1.4.11). Three tokens failed
when it was first written and were darkened.

---

## 11. Deployment

**Backend** — any host with secret environment variables:

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Set `GEMINI_API_KEY`, `DATABASE_URL`, and `CORS_ORIGINS` (your deployed frontend
origin). Serve over HTTPS.

**Frontend** — any static host:

```bash
npm run build          # outputs frontend/dist
```

Set `VITE_API_BASE_URL=https://your-backend.example.com/api` at build time,
since the dev proxy does not exist in production.

---

## 12. Known limitations

- Estimates come from the model's general knowledge, not live local pricing. They
  are directionally useful, not quotations.
- Gemini's free tier returns transient `503 UNAVAILABLE` under load. This is
  handled and retryable from the UI, but a demo may need a second attempt.
- No authentication, so saved plans are shared by everyone using that backend.
- Regeneration produces a fresh plan rather than editing sections individually;
  per-section regeneration is listed as a secondary objective in §4.2.
- Plan export uses the browser's print dialog ("Save as PDF") rather than
  server-side PDF rendering.
