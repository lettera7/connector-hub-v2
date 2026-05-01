# AGENTS.md

## Project context

This repository contains `connector-hub-v2`, a dashboard for matching and analyzing data between Fatture in Cloud and Float.com.

The goal is to help Lettera7 understand:
- real revenue (Fatture in Cloud)
- planned and worked hours (Float)
- project sustainability
- internal costs and margins
- mismatches between admin and planning data

This is a decision-making tool, not just a technical integration.

---

## How to work

Before making changes:
- read project structure and stack
- understand existing patterns
- check scripts (test, build, lint)
- prefer small, incremental changes

If something is unclear:
- make a reasonable assumption
- document it

Stop only if:
- credentials are missing
- a destructive decision is required

---

## Core priorities

Always optimize for:
- data correctness
- traceability
- clear matching logic
- explicit “unmatched” states
- readability for non-technical users

---

## Matching logic

Never assume perfect naming between systems.

Handle cases like:
- client in Fatture in Cloud but not in Float
- project in Float without invoices
- similar names (not identical)
- multiple projects per client
- multiple documents per project
- retainers / split invoices / deposits

Keep separate:
- client
- project
- document
- date of invoice
- work period
- hours (planned / worked)
- cost
- revenue
- margin

---

## Economic rules

Do NOT mix:
- issued revenue
- collected revenue
- accrual (competence)

If uncertain → show it, don’t fake precision.

---

## Float rules

Float = planning source.

Use:
- project
- resource
- assigned hours
- worked hours (if available)
- capacity

Important:
👉 treat 80–85% as realistic max capacity (not 100%)

---

## UX principles

The dashboard must be readable by non-technical users.

Key sections:
- connection status (Fatture in Cloud / Float)
- total revenue
- yearly target (editable)
- progress %
- monthly trend
- revenue vs hours vs cost
- unmatched data
- manual mapping UI

Every number must be explainable.

---

## Security

Never commit:
- API keys
- tokens
- `.env`
- real data

Use env variables + `.env.example`.

---

## Code structure

Keep logic separated:
- data fetching
- normalization
- matching
- calculations
- UI

Matching logic must be testable.

---

## Tests (mandatory mindset)

Before commit:
- run tests if present
- run lint/build if available

When touching logic:
- add tests

Test cases:
- exact match
- fuzzy match
- no match
- multi-project
- multi-document
- missing data
- API failure

---

## Commits

Keep them:
- small
- clear

Examples:
- `fix matching logic`
- `add unmatched projects view`
- `improve revenue aggregation`

---

## Errors

Avoid generic errors.

Prefer:
- “Float token missing”
- “No project linked to invoice”
- “Cannot calculate margin”

---

## Mock data

Use realistic imperfect data:
- missing links
- split invoices
- projects without revenue
- revenue without hours

Perfect data = useless for testing

---

## Avoid

- large refactors
- hidden assumptions
- automatic destructive actions
- over-smart matching
- misleading UI

---

## Goal

Build a dashboard that answers:

- Are we making money?
- Where are we losing margin?
- Are projects sustainable?
- Are admin and planning aligned?

Every change should move toward this.
