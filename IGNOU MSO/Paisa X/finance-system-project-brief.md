# Household Finance System — Project Brief
*India-specific · hledger-based · Two-person household · Open-source candidate*

---

## 1. What We're Building & Why

### Dual Purpose
| Goal | Description |
|---|---|
| **Primary** | A reliable, low-maintenance personal finance system for a two-person household |
| **Secondary** | An eventually open-source product others (India-focused households) can fork |

### Hard Constraints
- **Entirely free tooling** — no paid SaaS, no subscriptions
- **Low maintenance overhead** — one spouse will not independently manage technical tooling
- **Devices** — Android (daily driver) + Windows (desktop)
- **India-specific** — April–March financial year, INR, Indian tax/investment structures (PPF, EPF, Schedule AL, etc.)
- **No shortcuts on data integrity** — `hledger --strict` from day one

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       CAPTURE LAYER                             │
│  ┌──────────────────┐        ┌────────────────────────────────┐ │
│  │  Custom PWA       │        │  Google Sheets + Apps Script   │ │
│  │  (Vercel)         │        │  (capture buffer / bulk entry) │ │
│  │  Android-friendly │        │                                │ │
│  │  EN / HI / GU     │        │                                │ │
│  └────────┬─────────┘        └──────────────┬─────────────────┘ │
│           │                                 │                   │
│           └──────────────┬──────────────────┘                   │
└──────────────────────────┼──────────────────────────────────────┘
                           │ hledger journal entries (.journal)
┌──────────────────────────▼──────────────────────────────────────┐
│                     SOURCE OF TRUTH                             │
│                  GitHub Private Repo                            │
│           finance/2025-26/*.journal  (plain text)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ git push triggers
┌──────────────────────────▼──────────────────────────────────────┐
│                   PROCESSING LAYER                              │
│               GitHub Actions CI/CD                              │
│   hledger commands → pre-generated static JSON reports          │
└────────────────┬─────────────────────────┬──────────────────────┘
                 │                         │
┌────────────────▼────────┐  ┌─────────────▼────────────────────┐
│  Paisa (local, desktop) │  │  Custom Next.js Dashboard        │
│  - Bank CSV import      │  │  (Vercel, reads static JSON)     │
│  - Journal editing UI   │  │  - Net worth, cash flow,         │
│  - Tax loss harvesting  │  │    investment allocation,        │
│  - PDF import           │  │    budget vs actuals             │
│  - hledger mode via     │  └──────────────────────────────────┘
│    ledger_cli: hledger  │
└─────────────────────────┘
```

**Key insight:** Paisa is a stateful Go HTTP server with persistent SQLite — it cannot run on Vercel. GitHub Actions pre-generates all reports as static JSON; Vercel only serves that JSON to the Next.js frontend. This is the correct compute pattern.

---

## 3. Tech Stack — Every Component Justified

| Component | Tool | Why This, Not Something Else |
|---|---|---|
| Accounting engine | **hledger** | Plain-text, scriptable, India-compatible, free forever, `--strict` enforces correctness |
| Source of truth | **GitHub private repo** | Free, versioned, conflict-resolvable, CI/CD native |
| Mobile capture | **Custom PWA on Vercel** | Works on Android without app store; spouse-usable; supports EN/HI/GU |
| Bulk capture | **Google Sheets + Apps Script** | Zero setup for spouse, familiar UI, scriptable export |
| Bank import + editing | **Paisa** | Best-in-class CSV importer for Indian banks, hledger-compatible, tax harvesting built in |
| Report generation | **GitHub Actions** | Free CI minutes, runs on every push, produces deterministic static JSON |
| Dashboard | **Custom Next.js on Vercel** | Free hosting, reads static JSON — no server-side compute needed |
| (Deferred) Compute VM | **Oracle Cloud Always Free ARM** | For anything needing persistent server later (Paisa web, scheduled jobs) |

**Rejected alternatives:**
- Google Looker Studio — redundant, routes financial data through Google servers
- hledger WASM on Vercel Edge Functions — 50ms CPU limit kills full-year datasets
- Paisa on Vercel — stateful Go binary, persistent SQLite, writable filesystem: all incompatible

---

## 4. Repository Structure

```
finance/                          ← GitHub private repo root
└── 2025-26/                      ← Financial year April 2025 – March 2026
    ├── main.journal              ← Master file; includes all others
    ├── accounts.journal          ← 361 account declarations (READY ✓)
    ├── opening.journal           ← Opening balances (to be filled)
    ├── transactions/
    │   ├── 2025-04.journal       ← One file per month
    │   ├── 2025-05.journal
    │   └── ...
    └── prices.journal            ← Commodity prices (gold, stocks)
```

---

## 5. Account Structure (361 Accounts)

The account tree is India-specific and Schedule AL-mappable from day one.

### Top-Level Hierarchy

```
Assets
├── Current
│   ├── Bank:HDFC:Savings
│   ├── Bank:HDFC:Salary           ← salary credited here
│   ├── Bank:SBI:Savings
│   ├── Bank:AU:Savings
│   ├── Wallet:Paytm
│   ├── Wallet:PhonePe
│   └── Cash:Home                  ← physical cash tracking
├── Investment
│   ├── Equity:Zerodha             ← NSE/BSE stocks
│   ├── Equity:Groww
│   ├── MutualFund:...
│   ├── PPF:AlmaasUAN
│   ├── EPF:EPFO:AlmaasUAN         ← EPFO via UAN
│   ├── EPF:Trust:PreviousEmployer ← company trust from prior job
│   ├── FD:...
│   ├── RD:...
│   └── Gold
│       ├── Jewellery              ← valued in grams × MCX price
│       └── Coins
└── Receivable:...

Liabilities
└── (no active loans currently)

Income
├── Salary:Almaas:Gross            ← GROSS salary approach
├── Salary:Spouse:Gross
├── Investment:Dividends
├── Investment:Interest
└── ...

Expenses
├── Housing, Food, Transport, Health, Education, ...
├── Misc:Uncategorized             ← weekly review bucket
├── Misc:CashVariance              ← cash reconciliation account
└── ...

Equity
├── Opening:Almaas
├── Opening:Spouse
├── PersonalAllowance:Almaas       ← private spending model
└── PersonalAllowance:Spouse
```

### Salary Modelling (Gross Approach)

```journal
; Example: April salary posting
2025-04-01 Salary - Almaas
    Income:Salary:Almaas:Gross          ₹-85,000.00
    Assets:Investment:EPF:EPFO:Almaas    ₹3,600.00   ; employee EPF 12%
    Expenses:Tax:TDS:Almaas             ₹8,500.00   ; TDS deducted at source
    Assets:Current:Bank:HDFC:Salary     ₹72,900.00  ; net credited
```

This makes TDS, EPF contributions, and net-in-hand all explicit — critical for ITR reconciliation.

### Cash Tracking

```journal
; Withdrawal from ATM
2025-04-03 ATM Withdrawal
    Assets:Current:Cash:Home            ₹5,000.00
    Assets:Current:Bank:HDFC:Savings   ₹-5,000.00

; Weekly cash reconciliation — physical count vs ledger
2025-04-07 Cash Reconciliation
    Assets:Current:Cash:Home           ₹-200.00
    Expenses:Misc:CashVariance          ₹200.00    ; untracked spend
```

### Physical Gold Valuation

```journal
; prices.journal — updated periodically from MCX
P 2025-04-01 Au ₹9,200/g

; Asset declared in grams
2025-04-01 Opening Balance - Gold Jewellery
    Assets:Investment:Gold:Jewellery    150 Au
    Equity:Opening:Almaas
```

`hledger balance Assets:Investment:Gold --value=now` converts to INR automatically.

---

## 6. Paisa Configuration

`paisa.yaml` at repo root:

```yaml
ledger_cli: hledger           # ← critical: tells Paisa to use hledger syntax
journal_path: finance/2025-26/main.journal
db_path: paisa.db

commodities:
  - name: Au
    type: metal
    price: MCX                # MCX gold price feed

accounts:
  - name: Assets:Investment:Equity:Zerodha
    type: equity
```

Paisa handles: HDFC/SBI/AU bank CSV → hledger journal, PDF bank statements, tax loss harvesting across Zerodha/Groww, and a local web UI for editing.

---

## 7. Payment Mix & Transaction Volume

| Method | Frequency | Notes |
|---|---|---|
| Cash | Heavy | Full double-entry; weekly reconciliation |
| SBI Debit | Regular | CSV import via Paisa |
| UPI (GPay / PhonePe / Paytm) | Regular | Wallet-level tracking |
| HDFC Credit Card | Regular | Monthly statement import |
| HDFC Debit | Occasional | |

**Volume:** ~50–150 transactions/month across all accounts. Manageable for weekly batch review.

---

## 8. Spouse Usability Model

The non-technical spouse interacts **only** through:
1. **PWA** — mobile expense entry (tap, category, amount, done)
2. **Google Sheets** — optional bulk logging if they prefer

The PWA is the critical path for household adoption. If the PWA fails the usability test, the system fails.

**Personal Allowance model** for privacy: each spouse has a `PersonalAllowance` equity account. Private spending is not tracked at transaction level — only the top-up transfer is recorded. This is a social/trust design, not a technical encryption solution.

---

## 9. Development Sequence (Burst-Based)

The sequencing is deliberate. Do not jump ahead.

```
Phase 1 — CAPTURE          (build & validate first)
├── Google Sheets template + Apps Script export
├── PWA: English-first expense entry
├── Validate: real transactions flowing into hledger for 2+ weeks
└── Gate: both spouses using it without friction

Phase 2 — IMPORT           (only after Phase 1 is stable)
├── Paisa setup (local, Windows)
├── Bank CSV import for HDFC, SBI, AU
├── Opening balances
└── Gate: 60+ days of clean, reconciled data

Phase 3 — REPORTING        (only after real data exists)
├── GitHub Actions: hledger → static JSON pipeline
├── Next.js dashboard on Vercel
└── Gate: dashboard reflects reality, not mock data

Phase 4 — DEFERRED
├── Oracle Cloud ARM VM (persistent server needs)
├── PWA: Hindi + Gujarati localisation
└── Paisa fork/rebrand decision (after 60+ days real use)
```

**Why this order?** "Both spouses equally involved, variable time, everything in 4 weeks" kills most side projects. Burst-based sequencing with hard gates prevents the failure mode of building a beautiful dashboard with no real data behind it.

---

## 10. Key Principles & Non-Negotiables

| Principle | What It Means In Practice |
|---|---|
| `--strict` from day one | Every account used must be declared in `accounts.journal`; no typos silently create phantom accounts |
| Static JSON, not live queries | GitHub Actions generates reports; Vercel just serves files — no server costs, no cold starts |
| No paid tools, ever | Every component has a free path; Oracle Free Tier is the ceiling for compute |
| Real data before dashboard | 60+ days of clean transactions before building any visualisation layer |
| Spouse friction = system death | PWA must be as frictionless as a UPI payment app |
| Schedule AL from day one | Account structure maps to IT return Schedule AL — no retro-fitting needed at tax time |
| Deferred complexity is not abandoned | Oracle VM, multilingual PWA, fork/rebrand are on the roadmap, just not now |

---

## 11. What's Ready Right Now

| Artefact | Status |
|---|---|
| `accounts.journal` — 361 account declarations | ✅ Generated, ready to save |
| Architecture decisions | ✅ Locked |
| Tech stack | ✅ Locked |
| Financial specifics (banks, investments, salary model) | ✅ Locked |
| GitHub private repo | ✅ Created, awaiting content |
| `paisa.yaml` skeleton | ✅ Designed |

**Next action: Phase 1 begins.**
Save `accounts.journal` to `finance/2025-26/accounts.journal`, create `main.journal` that includes it, and push the repo skeleton. Then build the Google Sheets capture template.

---

## 12. Quick Reference Cheatsheet

```
Repo layout    : finance/2025-26/{main,accounts,opening,transactions/,prices}.journal
hledger flag   : --strict (always)
Paisa config   : ledger_cli: hledger
Financial year : April 2025 → March 2026
Currency       : INR (₹), commodity Au for gold (grams)
Salary model   : Gross — TDS + EPF deducted explicitly
Cash variance  : Expenses:Misc:CashVariance
Uncategorized  : Expenses:Misc:Uncategorized (weekly review)
Deployments    : PWA → Vercel, Dashboard → Vercel, Paisa → local Windows
CI/CD          : GitHub Actions → static JSON → Vercel reads
```
