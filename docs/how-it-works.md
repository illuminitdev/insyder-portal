# How Insyder works

- [1. The idea in one picture](#1-the-idea-in-one-picture)
- [2. Who's who: companies, workspaces and members](#2-whos-who-companies-workspaces-and-members)
- [3. Roles: what each person does](#3-roles-what-each-person-does)
- [4. The life of a lead](#4-the-life-of-a-lead)
- [5. Each role's day, step by step](#5-each-roles-day-step-by-step)
- [6. How the parts connect](#6-how-the-parts-connect)
- [7. What happens when you click something](#7-what-happens-when-you-click-something)
- [8. Folder map: what lives where](#8-folder-map-what-lives-where)
- [9. Ground rules the app enforces](#9-ground-rules-the-app-enforces)

---

## 1. The idea in one picture

```mermaid
flowchart LR
    A["🧭 Find leads<br/><small>search public sources<br/>for buying signals</small>"]
    B["🔍 Research<br/><small>check each signal<br/>against its source</small>"]
    C["✅ Review<br/><small>a sales reviewer<br/>accepts or returns it</small>"]
    D["💼 Sell<br/><small>deal, outreach drafts,<br/>tasks</small>"]
    E["🔗 Connect to CRM<br/><small>send accepted leads<br/>to HubSpot / Salesforce</small>"]
    A --> B --> C --> D --> E
    C -- "returned with a reason" --> B
```

A **buying signal** is public evidence that a company may soon buy infrastructure, for example a new data centre announcement, infrastructure job ads, a hardware refresh or a public tender. Every signal is saved **with its source**, so anyone can check it.

---

## 2. Who's who: companies, workspaces and members

```mermaid
flowchart TB
    P["Platform admin<br/><small>(Insyder team)</small>"] --> T1["Company (tenant)<br/>e.g. Acme Ltd"]
    P --> T2["Company (tenant)<br/>e.g. Other Corp"]
    T1 --> W1["Workspace<br/>Default Workspace"]
    T1 --> W2["Workspace<br/>UK sales"]
    W1 --> M1["Members<br/><small>each with ONE role<br/>in this workspace</small>"]
    W2 --> M2["Members"]
```

| Level | What it is |
|---|---|
| **Platform admin** | The Insyder team. Approves "Create account" requests, creates companies and sees platform-wide usage. Works in `/platform`. |
| **Company (tenant)** | One customer organisation. Its data is fully separated from every other company. It has one research budget per month and one CRM connection. |
| **Workspace** | A team or region inside a company (e.g. "UK sales"). Accounts, tasks, playbooks and settings belong to a workspace. |
| **Member** | A person in a workspace with **one role**. The same person can have different roles in different workspaces. |

Access comes **only** from an explicit membership. Belonging to a company does not by itself give access to its workspaces.

---

## 3. Roles: what each person does

Each role gets **its own portal**, with its own address (`/admin`, `/researcher`, `/reviewer`, `/sdr`, `/analyst`, `/partner`), its own menu and its own Overview dashboard.

| Role | Their job | Main pages |
|---|---|---|
| **Tenant admin** | Runs the workspace: members, settings, playbooks, suppression list, usage. **Only person who sends leads to the CRM.** Can do everything else too. | Overview, Discover, Accounts, Outreach, Reports, Members, Workspaces, Settings |
| **Researcher** | Finds leads, runs research, reviews evidence, writes the qualification brief, sends it to a named reviewer. | Overview, My leads (Qualify a lead, Work my tasks, Tasks), Find leads, Accounts, Drafts |
| **Sales reviewer** | Reads briefs and **accepts** (names an owner and next action), **sends back** (with a reason) or **rejects**. Manages deals and partner handoffs. | Overview, Review (Review a brief, Sales acceptance), Accounts, Outreach |
| **SDR** | Works accepted accounts: calls, emails and follow-ups, records outcomes, updates the deal, approves drafts. | Overview, My work, Accounts, Drafts |
| **Analyst** | Reads reports only. Changes nothing. | Overview, Reports |
| **Partner** | An outside company. Sees **only** the handoffs shared with them, and only the fields chosen for them. | Overview, Shared with me |

```mermaid
flowchart LR
    R["Researcher"] -- "sends brief to a named reviewer" --> SR["Sales reviewer"]
    SR -- "sends back with a reason" --> R
    SR -- "accepts, names an owner" --> SDR["SDR"]
    SR -- "shares a handoff" --> PA["Partner"]
    ADM["Tenant admin"] -- "assigns research tasks" --> R
    ADM -- "sends accepted leads" --> CRM[("CRM<br/>HubSpot / Salesforce")]
    AN["Analyst"] -. "reads reports" .-> REP["Reports"]
```

---

## 4. The life of a lead

A lead (an **account**) has two separate statuses: one for research and one for sales acceptance.

### Research status

```mermaid
stateDiagram-v2
    [*] --> Unresearched: added (search, CSV import or by hand)
    Unresearched --> Researching: Run research
    Researching --> Researched: sources found
    Researching --> Failed: provider error
    Failed --> Researching: try again
    Researched --> Researching: Re-research
```

### Acceptance status

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> ReadyForReview: researcher sends to a named reviewer
    ReadyForReview --> Accepted: reviewer accepts (owner + next action)
    ReadyForReview --> NeedsResearch: reviewer sends back (reason)
    ReadyForReview --> Rejected: reviewer rejects (reason)
    NeedsResearch --> ReadyForReview: researcher fixes and sends again
    Accepted --> ReadyForReview: reviewer reopens
    Rejected --> ReadyForReview: reviewer reopens
    Accepted --> [*]: Sell phase (deal, drafts, CRM)
```

### The steps on an account page

The account page walks through the lead as steps, grouped in three phases. A step opens only when the steps it depends on are done. **Each person sees their own steps**; other roles' steps are read-only for them and don't count in their progress.

| Phase | Step | Done when | Owner |
|---|---|---|---|
| Research | Research the company | research finished | Researcher |
| Research | Check the evidence | at least one source reviewed | Researcher |
| Research | People | a sourced contact added, or skipped | Researcher |
| Review | Qualification brief | facts and rationale written | Researcher |
| Review | Send for sales review | sent to a named reviewer | Researcher |
| Review | Sales decision | accepted | Sales reviewer |
| Sell | Opportunity | deal recorded | Sales reviewer / SDR |
| Sell | Draft outreach | a draft approved | Researcher / SDR |
| Sell | Send to CRM | synced, or skipped | Tenant admin |
| Sell | Partner handoff (optional) | — | Sales reviewer |

---

## 5. Each role's day, step by step

### Researcher

```mermaid
flowchart TD
    A["Overview: my tasks, returned leads"] --> B["Qualify a lead<br/><small>filter: My tasks · Not started · In progress ·<br/>Returned · Sent · Completed</small>"]
    B --> C["1 · Pick a lead"]
    C --> D["2 · Check evidence<br/><small>mark sources reviewed</small>"]
    D --> E["3 · Fill the brief<br/><small>facts + rationale</small>"]
    E --> F["4 · People<br/><small>sourced contacts</small>"]
    F --> G["5 · Send for review<br/><small>choose the reviewer</small>"]
    G --> H{"Reviewer decides"}
    H -- "Returned" --> D
    H -- "Accepted / Rejected" --> I["Done: shows under Completed"]
```

- **Find leads** (Discover): describe what you're looking for in plain words. Insyder shows how it understood the request **before** running it, then searches and lists matching companies.
- A research task from the admin opens straight in **Qualify a lead**. In **Work my tasks**, research tasks open there too.

### Sales reviewer

```mermaid
flowchart TD
    A["Bell / Overview:<br/>briefs sent to me"] --> B["Review a brief"]
    B --> C["Read the brief and the evidence"]
    C --> D{"Make your decision"}
    D -- "Accept" --> E["Choose who works it + first step"]
    D -- "Send back" --> F["Reason + what to fix"]
    D -- "Reject" --> G["Reason"]
    E --> H["Lead moves to Sell:<br/>deal, drafts, handoff"]
```

### SDR

```mermaid
flowchart LR
    A["Work my tasks"] --> B["Know the account"] --> C["Make the call or email<br/>(outside Insyder)"] --> D["Record the outcome"] --> E["Update the deal (optional)"]
```

### Tenant admin

```mermaid
flowchart LR
    A["Settings: offer, playbooks,<br/>suppressions, CRM connection"] --> B["Members: add people,<br/>give roles"]
    B --> C["Assign research tasks"]
    C --> D["Overview: team workload,<br/>funnel, pipeline"]
    D --> E["Send to CRM:<br/>accepted leads, not sent yet"]
```

### Partner

Opens **Shared with me**, reads the fields shared with them, then **acknowledges** or **returns** each handoff.

---

## 6. How the parts connect

```mermaid
flowchart LR
    subgraph Browser
        FE["Frontend<br/>Next.js web app<br/><small>localhost:3000</small>"]
    end
    subgraph Server
        API["Backend API<br/>Fastify<br/><small>localhost:4000 /v1/...</small>"]
        WK["Worker<br/>pg-boss jobs"]
    end
    DB[("PostgreSQL on Neon<br/><small>all data + job queue</small>")]
    EXA["Exa<br/><small>web search API</small>"]
    CRM["HubSpot /<br/>Salesforce"]

    FE -- "HTTPS + session cookie" --> API
    API -- "read / write" --> DB
    API -- "queue a job" --> DB
    WK -- "pick up jobs" --> DB
    WK -- "search public sources" --> EXA
    WK -- "create / update records" --> CRM
    API -- "check credentials" --> CRM
```

| Part | What it does |
|---|---|
| **Frontend** (`frontend/`) | Everything users see. Calls the API, keeps nothing secret. |
| **Backend API** (`backend/src/index.ts`) | Checks who you are and what your role allows, applies the business rules, reads and writes the database. Every address starts with `/v1/`. |
| **Worker** (`backend/src/worker.ts`) | Does the slow work in the background so pages never hang: research runs, CSV imports, CRM syncs, and scheduled monitor checks (every minute it queues monitors that are due). |
| **Database** | One PostgreSQL database holds all the data **and** the job queue. |
| **Exa** | The web search service research uses to find sources. See [How research works](exa-research.md). |
| **HubSpot / Salesforce** | The company's CRM. Accepted leads are sent there by the tenant admin. |

The API and the worker don't call each other. The API **writes a job** to the database, and the worker **picks it up**. If the worker is busy or restarting, jobs wait safely and run later.

---

## 7. What happens when you click something

### Example 1: "Run research" on an account

```mermaid
sequenceDiagram
    actor U as Researcher
    participant FE as Frontend
    participant API as Backend API
    participant DB as Database
    participant WK as Worker
    participant EXA as Exa

    U->>FE: clicks Run research
    FE->>API: POST /v1/workspaces/:id/research-runs
    API->>API: check login, role, workspace, suppression list
    API->>DB: reserve research budget, save run (queued), queue job
    API-->>FE: runId
    FE->>API: polls run status
    WK->>DB: picks up the job
    WK->>EXA: search with the playbook's signals
    EXA-->>WK: pages + content
    WK->>DB: save sources, evidence, signals, priority score
    WK->>DB: run = completed, account = researched
    API-->>FE: completed
    FE-->>U: new evidence appears
```

### Example 2: Sending a brief to a reviewer

```mermaid
sequenceDiagram
    actor R as Researcher
    participant API as Backend API
    participant DB as Database
    actor S as Sales reviewer

    R->>API: send for review (note + chosen reviewer)
    API->>API: reviewer must be a sales reviewer or admin;<br/>at least one reviewed source
    API->>DB: save rationale, status → Ready for review
    API->>DB: create a Sales review task for the reviewer
    API->>DB: complete the research task (if any)
    S->>API: opens the bell (refreshes every minute)
    API-->>S: "1 brief sent to you for review"
```

---

## 8. Folder map: what lives where

```
Insyder/
├── docs/                     ← you are here
├── backend/                  ← API + worker (Node.js, TypeScript)
│   └── src/
│       ├── index.ts          starts the API server
│       ├── worker.ts         starts the background worker
│       ├── auth/             passwords, sessions, role → permission list
│       ├── config/           reads and checks settings from .env
│       ├── middleware/       "who is calling and may they?" on every request
│       ├── routes/
│       │   ├── health.ts     /health check
│       │   └── v1/           one file per topic: the API addresses (107 endpoints)
│       ├── services/         the business rules, one file per topic
│       ├── jobs/             queues + handlers: research, CSV import, CRM sync, monitors
│       ├── providers/
│       │   ├── research/     Exa web search
│       │   └── crm/          HubSpot and Salesforce
│       ├── db/
│       │   ├── schema/       table definitions (one file per area)
│       │   ├── migrations/   numbered SQL changes to the database
│       │   ├── migrate.ts    applies migrations
│       │   └── seed.ts       creates the first company, workspace and admin
│       ├── utils/            small helpers: CSV, ids, encryption, normalising names
│       └── test/             release-gate and integration tests
└── frontend/                 ← web app (Next.js, React, TypeScript)
    └── src/
        ├── app/
        │   ├── login/        sign-in page
        │   ├── password/     forced password change
        │   ├── platform/     platform admin area
        │   └── [portal]/     every role's pages: /admin/..., /researcher/..., etc.
        │       ├── overview/   dashboards
        │       ├── discover/   find leads, playbooks
        │       ├── accounts/   watchlist, account page, qualify, review, CRM ...
        │       ├── outreach/   tasks, work my tasks, drafts
        │       ├── reports/    outcomes
        │       ├── members/    people and roles
        │       ├── settings/   offer, suppressions, usage, CRM, password
        │       └── shared/     partner handoffs
        ├── components/       reusable UI, grouped by area (accounts, overview, guide, ui ...)
        ├── hooks/            shared state: signed-in workspace, portal, guided steps
        └── lib/
            ├── api/          one file per topic: how the frontend calls the API
            ├── auth/         session calls and the role → permission list
            └── utils/        dates, CSV, small helpers
```

### Routes vs services (why two files with the same name)

Most topics have **two files with the same name**, for example `routes/v1/playbooks.ts` and `services/playbooks.ts`. They are **not duplicates**; they do two different jobs:

| File | Job | Example |
|---|---|---|
| `routes/v1/<topic>.ts` | The **front desk**: the web address, login and role check, input validation, audit log, the answer | "POST `/v1/workspaces/:id/playbooks`: is the caller an admin? is the body valid?" |
| `services/<topic>.ts` | The **actual rules** and database work, reused by several routes, the worker and tests | "create a new playbook version", "who can be a reviewer" |

The frontend mirrors this: `frontend/src/lib/api/<topic>.ts` holds the functions that call the matching routes.

### Why "v1"?

`/v1/` is the **version of the API**. If the API ever has to change in a way that would break existing callers (the frontend, a mobile app, a customer's integration), the new behaviour goes under `/v2/` while `/v1/` keeps working. Users never see it.

---

## 9. Ground rules the app enforces

- **Nothing is ever sent automatically.** No emails, calls or messages. Drafts are written, checked and approved, then people use them themselves.
- **Evidence first.** A lead can't be accepted without at least one reviewed source. Unknown facts stay "unknown" and never raise the score.
- **Sources are untrusted web data** until a person reviews them.
- **The priority score is a guide, not a promise.** It's 45% fit, 35% recency and 20% source quality. Missing dates cap recency.
- **The suppression list wins.** Companies or domains on it can't be researched or contacted.
- **Every decision is recorded** with who, when and why: acceptance decisions, playbook versions, superseded brief values and the audit log.
- **Each company's data is separate,** and each role only sees what it's allowed to. The server checks this on every request, not just the menu.
