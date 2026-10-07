# Backend admin access setup

Admin authentication is separate from citizen authentication. Admin access is granted only to accounts with the `admin` or `owner` role; new citizen accounts continue to receive the `citizen` role. Admin API routes verify both the signed admin token and the account's current database role.

## Bootstrap the first owner

Configure `MONGO_URI` and a `JWT_SECRET` of at least 32 characters in the backend `.env`, then run this in the backend directory. The command connects to MongoDB directly; the API server need not be running:

```sh
npm run admin:bootstrap
```

Enter the owner's email, name, and a password of at least 12 characters (maximum 72 UTF-8 bytes) when prompted. The password input is hidden. The command creates only one owner; it will not promote or overwrite an existing account. Keep the terminal and database credentials private.

An owner can create additional admin accounts through `POST /api/v1/admin/users` with an admin bearer token and JSON containing `email`, `name`, and a password of at least 12 characters (maximum 72 UTF-8 bytes). There is no public admin registration route. The endpoint always creates the `admin` role, never another owner.

For local development, the admin frontend origin defaults to `http://127.0.0.1:5181`. In production, set `ADMIN_FRONTEND_URL` to the exact deployed admin origin. Set `FRONTEND_URL` separately for the citizen app origin.

## Password recovery

Citizen and admin accounts can request a six-digit password reset code using `POST /api/v1/user/forgot-password` or `POST /api/v1/admin/forgot-password` with `{ "email": "..." }`. The matching reset endpoint (`/api/v1/user/reset-password` or `/api/v1/admin/reset-password`) accepts `email`, `code`, and `password`. Codes are stored as keyed hashes, expire after 10 minutes, allow at most five verification attempts, and are limited to three sends per account per hour with a 60-second resend cooldown. Successful resets delete refresh tokens and increment the account's auth version so existing access tokens are rejected. Passwords must be at least 12 characters and no more than 72 UTF-8 bytes.

Configure SMTP credentials in the backend `.env` to enable delivery: `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, and `MAIL_FROM`. Use credentials from an SMTP provider with a suitable free tier for low-volume deployment; do not commit real values. Until these values are configured, recovery endpoints respond with a service-unavailable error. Authentication and recovery request rate limits use the process-local in-memory store; deployments with multiple backend instances should replace it with a shared rate-limit store.

## Admin shared settings

Departments, officers, and reply templates are managed through the authenticated `/api/v1/admin/departments`, `/api/v1/admin/officers`, and `/api/v1/admin/reply-templates` endpoints. Any signed-in admin may read the settings; only the owner may create, update, or deactivate records. Records are deactivated rather than deleted so future complaint assignments can retain their references. An active department cannot be deactivated until its active officers have been reassigned or deactivated.

## Admin complaint queue

`GET /api/v1/admin/complaints` returns a paginated, privacy-aware complaint queue and status counts to signed-in admins. Supported query parameters are `status`, `category`, `area`, `sla`, `search`, `sort`, and `page`; the API validates each value and limits pages to 10 rows. Status values include `received`, `under_review`, `in_progress`, `waiting_for_citizen`, `resolved`, and `rejected`; `overdue` is a derived status based on an existing SLA deadline. Citizen phone numbers are not included in queue responses, and names marked private are suppressed.

`GET /api/v1/admin/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD` returns live overview and report metrics for an inclusive UTC date range (defaults to the last 30 days and supports ranges up to 366 days). Submitted counts, category/status breakdowns, submission trends, and recent complaint activity use complaints created or events recorded in the selected range. The current open count includes complaints not resolved or rejected, including those waiting for a citizen. Resolved counts are based on resolution events in the range; overdue counts are currently open complaints past their SLA deadline, excluding complaints waiting for a citizen or otherwise paused. Resolution rate is resolved during the range divided by submitted during the range. Recent activity is derived from complaint activity history; private internal notes are never included.

## Admin suggestions and complaint feedback

`GET /api/v1/admin/suggestions` returns paginated citizen submissions with real unread and per-type counts. It accepts `type` (`all`, `suggestion`, `thanks`, or `question`), `status` (`all`, `received`, or `read`), `search`, and `page`. Citizen names are returned only for signed-in users who did not request privacy; guest submissions and private names remain anonymous. `PATCH /api/v1/admin/suggestions/:referenceNumber` supports `read`, `unread`, `highlight` (with an `enabled` boolean), and `reply` (with a message). Replies are retained in the admin record and are not delivered to citizens.

`GET /api/v1/admin/feedback` returns paginated feedback submitted through the existing complaint-resolution flow, including resolution confirmation, rating, selected tags, comment, category, and complaint reference. It supports `search` and `page`, and includes aggregate rating and response counts. Feedback responses do not include citizen contact details.

## Citizen in-app notifications

`GET /api/v1/complaints/notifications?filter=all|unread&page=1` returns notifications derived from the signed-in citizen's or guest session's complaint activity, with unread and total counts. Admin messages, assignments, complaint status changes, resolution, rejection, and complaint receipt appear in the feed; internal notes and citizen-authored replies are excluded. `PATCH /api/v1/complaints/notifications/read` accepts `{ "ids": ["activity:<subdocument-id>"] }` or `{ "markAll": true }`. Notification read state is scoped to the authenticated user or guest session. The citizen app refreshes the unread count while open and offers an optional sound preference. Admin notifications already include complaint registration (`registered`) and citizen replies (`citizen_reply`).

## Citizen AI reliability

Citizen chat, voice, image analysis/generation, speech, translation, and web search use bounded provider timeouts and return generic retry guidance on provider failures. AI write/generation endpoints are limited to 60 requests per 15 minutes per session using a process-local in-memory limiter; multi-instance deployments should use a shared rate-limit store. Chat messages are limited to 4,000 characters and uploaded AI inputs are limited to 15 MB and checked against supported audio/image MIME types. AI operation logs record operation names, durations, outcomes, and normalized error codes only; prompts, transcripts, images, complaint details, and raw provider errors are not written to application logs. Provider keys and their rate limits remain the responsibility of their respective services; local operation logs are not a hosted monitoring/alerting service.

Admins can open `/api/v1/admin/complaints/:complaintNumber` for complaint details, assign an active department/officer and a 1–60 working-day SLA, add private internal notes, send citizen-visible messages, request more information, and update status. Rejection requires a reason and resolution requires a summary; resolution photos are optional. The SLA pauses while waiting for a citizen reply and resumes with the remaining weekday target when the citizen responds. Citizen replies return complaints from `waiting_for_citizen` to `in_progress`. Private notes are excluded from citizen responses. Citizens can reply with text and up to four photos through `POST /api/v1/complaints/:complaintNumber/messages`; closed complaints cannot receive messages. If a citizen reports a resolved complaint as not resolved, the complaint returns to `in_progress`.
