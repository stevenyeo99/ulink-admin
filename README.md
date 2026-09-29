# ulink-admin

AI claims automation for AYA Sompo health claims, built for ULINK (the TPA). Claims arrive by email or are created in
IAS; the system reads the documents, checks the member against IAS, checks the documents, picks the diagnosis and
benefit, decides STP by rules, and creates or revises the claim in IAS — explaining every decision on the case page,
in team emails and in IAS. People handle only what needs judgement: JD2 approves non-STP claims, and the review queue
holds every case the AI was unsure about.

| Package | What |
|---|---|
| [`src/ulink-api`](src/ulink-api) | Express API, jobs and pipelines (Postgres + pgvector, local LLM) |
| [`src/ulink-console`](src/ulink-console) | React dashboard for CSR / Ops / JD2 |

**Quick start:** [OPERATIONS.md](OPERATIONS.md) §1.

## Documentation

| Read this | To know |
|---|---|
| [CONTEXT.md](CONTEXT.md) | The words: TPA case number vs claim number, STP, suspense, barcode, JD1/JD2, … |
| [docs/imp/CLAIM_FLOW_END_TO_END.md](docs/imp/CLAIM_FLOW_END_TO_END.md) | How a case moves, step by step, for email and API cases |
| [DESIGN.md](DESIGN.md) | Why it is built this way; scaling up; decision log |
| [OPERATIONS.md](OPERATIONS.md) | Set up, run the pipelines, follow and fix a case, deploy |
| [BACKLOG.md](BACKLOG.md) | What is next |
| [AGENTS.md](AGENTS.md) | Rules for AI coding agents (and a good summary for developers) |
| [Enhancement tracker](docs/imp/demo/API%20DAY1/PREV_FEEDBACK/20260917_enhancement_status.md) | Status of the 17/09 meeting points and the change log |
