# Clinic CRM with a safe AI assistant

A small clinic CRM: patients, appointments, visit notes and follow-up emails. The AI **summarises a patient's history for the doctor** and **drafts follow-up emails that staff must approve before they are sent**. Approved emails are sent for real over SMTP.

> Use fake patients while learning. Real patient data needs consent, encryption, legal review (privacy law in your country) and a hardened deployment.

Stack: React (Vite), FastAPI, MongoDB Atlas, Groq LLMs, SMTP email. One repo, one Vercel project.

## Pages

1. **Dashboard**: today's schedule, follow-ups due, emails waiting, AI performance (p50 and p95 latency, cost per request, cache hit rate, verification pass rate), and an audit log for doctors.
2. **Patients**: search, add (name, phone, email, consent), view appointments and notes, **AI summary** with clickable citations, and **Draft email** (English or Urdu).
3. **Appointments**: book by date, mark done, no-show or cancelled.
4. **Approvals**: edit the subject and body, then **Approve and send email** or reject. This is the only place an email can leave the system.

## Safety design

| Concern | What the project does |
|---|---|
| Hallucination | Summary lines must cite notes like `[n2]`. A second model call fact-checks the summary against the notes. One retry, then it refuses. Unverified summaries are never cached. |
| Privacy | Names, phones, emails and ID numbers are removed before text reaches the LLM. Email drafts are built only from dates and the clinic name, never from clinical notes. |
| Prompt injection | Notes are wrapped as untrusted data. Hidden text and "ignore previous instructions" phrases are stripped. |
| Medical-advice guardrail | Emails mentioning doses, medicines or diagnosis are rejected, also after staff edit them. |
| Emergency guardrail | If recent notes mention things like chest pain, no automated email is drafted. |
| Consent | A patient needs an email address and "agreed to receive emails" ticked before a draft or send is possible. |
| Human approval | Drafts stay pending until staff click approve. Double clicks cannot send twice. |
| Access control | Signed login tokens (8 hours). Only doctors can read notes, run summaries or see the audit log. `APP_SECRET` is required: the server refuses to run without it. |
| Abuse limits | 5 failed logins locks a username for 15 minutes. 10 AI requests per minute and 20 emails per hour per user. |
| Audit | Every patient view, note, AI call, approval, rejection and failed send is logged. |

## Latency and cost

- Summaries are cached in MongoDB (1 hour). The cache key includes each note's id and timestamp, so a new note refreshes it automatically.
- Small model (`openai/gpt-oss-20b`) for drafts, fact checks and short histories. Large model (`openai/gpt-oss-120b`) for histories of more than 8 notes. Low reasoning effort is requested to keep calls quick.
- The dashboard shows measured p50, p95, cost and cache hit rate from your own requests, and "not measured yet" until there are some.
- No streaming, because verification must finish before an answer is shown.

## Setup

Requirements: Python 3.11+, Node 18+, a free MongoDB Atlas cluster, a Groq API key, and an email account for sending.

```bash
pip install -r requirements.txt
npm install
```

Copy `.env.example` to `.env` and fill it in.

**APP_SECRET** signs login tokens. Generate one and never commit it:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**Email (Gmail example).** Turn on 2-Step Verification in your Google account, then create an **App password** (Google Account, Security, App passwords; menu names can change). Use:
```
SMTP_USER=yourname@gmail.com
SMTP_PASS=the-16-character-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
```
Any other SMTP provider works the same way (port 465 uses SSL automatically). Gmail has daily sending limits, so for a real clinic use a transactional email service with your own domain.

**Test mode.** Set `EMAIL_OVERRIDE_TO=your-own-address@gmail.com` and every email goes to you instead of the patient, with the real recipient in the subject. The Approvals page shows a banner while it is on. Remove it only when you are ready to email real patients who agreed to it.

**Create your real users** (passwords need 10+ characters):
```bash
python api/index.py adduser dr.khan "a-long-password" doctor "Dr. Ayesha Khan"
python api/index.py adduser reception "another-long-password" staff "Reception Desk"
```

**Optional demo data** (refuses to run if patients already exist, `--force` erases everything):
```bash
python api/index.py seed-demo
```
This also creates the logins `doctor` / `doctor123` and `staff` / `staff123`. Delete them before real use.

Run both servers in two terminals, then open http://localhost:5173:
```bash
python -m uvicorn api.index:app --port 8000
npm run dev
```

## Tests

```bash
pip install mongomock pytest
pytest -q
```
They use a fake database, a fake LLM and a fake mail server, so no keys are needed. They do not test the real Groq models or a real mail provider, so send yourself a test email and read real summaries before trusting the app.

## Deploy to Vercel

1. Push the repo to GitHub (`.env` is in `.gitignore`).
2. Import it in Vercel and add every variable from `.env.example` as an environment variable.
3. In Atlas Network Access, allow Vercel's addresses (commonly `0.0.0.0/0`).
4. Create your users with the `adduser` command from your computer, using the same `MONGODB_URI`.

Not yet tested on Vercel, including SMTP from Vercel functions. Each AI call makes 2 to 4 LLM requests, so check that your plan allows the 60-second limit in `vercel.json`.

## Layout

```
api/index.py       FastAPI: auth, guardrails, AI features, email, audit, CLI
src/App.jsx        the four React pages and login
src/styles.css     styling
tests/test_api.py  offline tests
vercel.json        routing and function settings
```

## Known limitations

- No password reset or user management screen yet (use `adduser`).
- Regex guardrails (emergency words, medical-advice patterns) are simple and will miss cases. Treat them as a safety net and keep a human in the loop.
- Notes are not encrypted at rest beyond what MongoDB Atlas provides.
- No unsubscribe flow or delivery tracking for emails.
- The API sends error text to the page for debugging. Remove that before production.
- Cost uses estimated Groq prices stored in `PRICE`. Check Groq's pricing page.
- Groq retired its Llama 3.1 and 3.3 models on 2026-08-16, so this uses the gpt-oss models. If requests return 404, check Groq's model list.
