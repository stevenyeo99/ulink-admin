# Freshdesk email channel plan

## Context

ULINK uses Freshdesk email in production. ULINK does not give a UAT or sandbox account. We build and test on a personal Freshdesk trial account first.

Scope: account setup, email input, email output, and thread storage. Custom fields and ticket property updates are out of scope for now.

The code already has the switch point. `src/ulink-api/channels/index.js` selects the adapter by `CHANNEL_DRIVER`. `src/ulink-api/channels/freshdeskChannel.js` is a stub. The work is to fill `fetchNewSubmissions` and `sendReply` in that file. The callers do not change:

- `modules/email-intake/service.js` calls `fetchNewSubmissions(persistSubmission)`.
- `modules/email-sender/service.js` and `modules/api-email-sender/service.js` call `sendReply(submission, reply)`.

## Phase tracking

| Phase | Name | Status | Date done | Commit |
|---|---|---|---|---|
| 0 | Trial account setup | Done | 2026-11-03 | |
| 1 | Input: first message of a ticket | In progress | | |
| 2 | Input: follow-ups and attachments | Not started | | |
| 3 | Output: reply in the ticket | Not started | | |
| 4 | Output: ops forward and new outbound ticket | Not started | | |
| 5 | Thread storage: end-to-end test | Not started | | |

Status values: Not started, In progress, Done, Blocked.

## Rules for all phases

- Do one phase at a time. The owner approves the start of each phase.
- After each code phase, run `/code-review`, fix the findings, and suggest a commit message.
- Use only sample cases with fake names, NRC numbers, and bank accounts. Do not put real member data in a personal account.
- Keep the domain, API key, and email configuration id in configuration. The production values will be different.
- Use native `fetch`, `FormData`, and `Blob` from Node. No new dependency.
- Handle HTTP 429 with the `Retry-After` header. The trial has a low API rate limit.
- No schema change. Freshdesk messages use the existing tables `ulink_email_threads`, `ulink_email_messages`, and `ulink_email_attachments`.

## Phase 0: Trial account setup

Goal: a working Freshdesk account, and a manual round trip that works before any code.

Steps:

1. Go to `https://www.freshworks.com/freshdesk/signup/`.
2. Register with a project email address, not a private Gmail address.
3. Choose a helpdesk name, for example `ulinkstp`. The domain is then `ulinkstp.freshdesk.com`.
4. Open the activation email and set the password.
5. Write down the default support address: `support@ulinkstp.freshdesk.com`. Every email to this address becomes a ticket.
6. Open Profile settings (top right), then "View API key". Copy the key.
7. Get the email configuration id of the support address from `GET /api/v2/email_configs`.
8. Open Admin > Workflows > Email Notifications. Turn off "New Ticket Created" for the requester. If you do not, the test member gets an extra auto-reply for each email.
9. Create a second mailbox. This mailbox plays the member.
10. Run the manual round trip below.

```bash
FD=https://ulinkstp.freshdesk.com/api/v2
KEY=your_api_key

curl -u "$KEY:X" "$FD/tickets?order_by=created_at&order_type=desc"   # list
curl -u "$KEY:X" "$FD/tickets/1"                                      # first message + attachments
curl -u "$KEY:X" "$FD/tickets/1/conversations"                        # follow-ups
curl -L -o test.pdf "<attachment_url>"                                # download at once, the link expires
curl -u "$KEY:X" -H "Content-Type: application/json" \
  -X POST "$FD/tickets/1/reply" -d '{"body":"<p>Test reply</p>"}'      # reply in thread
```

Done when:

- An email from the member mailbox becomes a ticket.
- The test reply arrives in the member mailbox.
- A reply from the member mailbox shows on the same ticket, not as a new ticket.
- One sample JSON of a ticket and of a conversation is saved in `docs/imp/CR/SYSTEM_6/freshdesk/samples/`, with fake data only.

Note: the trial lasts 21 days. Phases 1 to 5 must finish inside this period.

## Phase 1: Input, first message of a ticket

Goal: a new Freshdesk ticket becomes a case with one inbound message.

Files: `config/index.js`, `channels/freshdeskChannel.js`.

Configuration (in `config/index.js` next to `channel`):

| Variable | Example |
|---|---|
| `CHANNEL_DRIVER` | `freshdesk` |
| `FRESHDESK_DOMAIN` | `ulinkstp.freshdesk.com` |
| `FRESHDESK_API_KEY` | from Phase 0 step 6 |
| `FRESHDESK_EMAIL_CONFIG_ID` | from Phase 0 step 7 |

Tasks:

1. Add a small request helper in `freshdeskChannel.js`: Basic auth (`<key>:X`), JSON, and 429 retry.
2. Use a fixed window of the last 24 hours. Each run reads the window again, so a ticket that failed is tried again on the next run. A ticket that fails for 24 hours is dropped, and the job errors show it until then.
3. Call `GET /tickets?updated_since=<now - 24h>&order_by=updated_at&order_type=asc`. Follow the pages. Keep only tickets created inside the window and not outbound (`source` 10).
4. Skip tickets already saved in `ulink_email_messages`. For each new ticket, call `GET /tickets/{id}?include=requester`.
5. Build one Submission for the first message and call `onSubmission`.

Mapping for the first message:

| Submission field | Value |
|---|---|
| `source` | `freshdesk` |
| `externalId` | `ticket:<ticketId>` |
| `messageId` | `fd-ticket:<ticketId>` |
| `inReplyTo`, `references` | null |
| `from` | `requester.email` |
| `to`, `cc` | `to_emails`, `cc_emails` |
| `subject` | `subject` |
| `bodyText` / `bodyHtml` | `description_text` / `description` |
| `receivedAt` | `created_at` |
| `attachments` | empty in this phase |

Done when:

- One email to the support address gives one case, one thread, and one inbound message.
- A second run of the intake job saves nothing new (dedupe on `source` plus `externalId`).

## Phase 2: Input, follow-ups and attachments

Goal: member replies join the same case, and files are saved.

Files: `channels/freshdeskChannel.js`.

Tasks:

1. Call `GET /tickets/{id}/conversations`. Keep only rows with `incoming: true` and `private: false`.
2. Build one Submission for each kept conversation.
3. Download each `attachment_url` at once into a Buffer. Put it in `attachments[].content`. Do this for the ticket and for each conversation.

Mapping for a follow-up:

| Submission field | Value |
|---|---|
| `externalId` | `conv:<conversationId>` |
| `messageId` | `fd-conv:<conversationId>` |
| `inReplyTo`, `references` | `fd-ticket:<ticketId>` |
| `from` | `from_email` |
| `bodyText` / `bodyHtml` | `body_text` / `body` |
| `receivedAt` | `created_at` |

Points to test:

- An image pasted in the email body can be an `<img>` link in `bodyHtml` and not in `attachments`. Test it with the body-link handling in `modules/email-intake/service.js`.
- A member who sends a new email (not a reply) creates a new ticket. The subject `(Ref: ...)` match in `threadMatcher.js` still works.

Done when:

- An email with two PDF files gives two saved attachments.
- A member reply with one more file joins the same case and thread.

## Phase 3: Output, reply in the ticket

Goal: the pipeline reply arrives in the member mailbox in the same email thread.

Files: `channels/freshdeskChannel.js`.

Tasks:

1. Read the ticket id from `submission.messageId` or `submission.references` (the `fd-ticket:<id>` value).
2. Call `POST /tickets/{id}/reply` with `body`, `cc_emails`, and attachments.
3. Convert `bodyText` to HTML: escape the text and put `<br>` for each line break.
4. Send attachments as `multipart/form-data` with `attachments[]`. The total is 20 MB at most.
5. Return `{ messageId: 'fd-conv:<conversationId>' }`.
6. On dev, set `SMTP_FROM` to the support address, because the senders save `config.smtp.fromAddr` on the outbound row.

Done when:

- A reply from `modules/email-sender/service.js` arrives in the member mailbox in the same thread.
- The outbound row is saved on the same thread with the `fd-conv:` value.

## Phase 4: Output, ops forward and new outbound ticket

Goal: internal notices and first API case emails work on Freshdesk.

Files: `channels/freshdeskChannel.js`.

Tasks:

| Case | Freshdesk call |
|---|---|
| `reply.to` is a different address from the requester (internal notice to ops) | `POST /tickets/{id}/forward` with `to_emails` |
| No ticket id (first API case email, no thread yet) | `POST /tickets/outbound_email` with `email`, `subject`, `description`, `email_config_id` |

- Return `fd-conv:<conversationId>` for a forward and `fd-ticket:<ticketId>` for a new outbound ticket.
- The forward choice is a default for dev. ULINK must confirm it (question 6 in `freshdesk_clarification.md`). The other option is a private note.

Done when:

- The ops address gets the internal notice as a forward.
- An API case email with no thread creates an outbound ticket in Freshdesk.

## Phase 5: Thread storage, end-to-end test

Goal: prove that one Freshdesk ticket stays one case and one thread through the full flow.

How the thread works (no code change expected):

- The first message of a ticket has `messageId = fd-ticket:<ticketId>`. Each follow-up has `references = fd-ticket:<ticketId>`.
- `matchOrCreateThread` in `modules/email-intake/threadMatcher.js` looks up `messageId` from `inReplyTo` and `references`. It finds the first message and joins the same thread.
- The two senders build the outbound `referencesHeader` from the last message. The `fd-ticket:<id>` value stays in the chain, so the adapter always finds the ticket id.
- An outbound ticket has `messageId = fd-ticket:<ticketId>`. A member reply to it arrives as a conversation and joins the same thread.
- `sourceUrl` on attachments stays null, because the Freshdesk link expires.

Test steps:

1. Send a sample claim email with two PDF files from the member mailbox.
2. Run the intake job. Make sure that one case, one thread, one message, and two attachments are saved.
3. Let the pipeline send a reply. Make sure that the member mailbox gets it in the same thread.
4. Reply from the member mailbox with one more file. Run the intake job. Make sure that it joins the same case.
5. Send an internal notice. Make sure that the ops address gets it.
6. Run an API case email with no thread. Reply from the member mailbox. Make sure that the reply joins the same case.
7. Look at the case in the console. Make sure that the thread shows all messages in order.

Known limit: IMAP and Freshdesk messages do not share one thread. A case that started on IMAP stays on IMAP. Switch the driver only on a clean dev database or for new cases.

Done when: all seven test steps pass.

## Out of scope for now

- Custom fields and ticket property updates (status, group, tags).
- Freshdesk webhooks. Polling is enough for the test.
- Running IMAP and Freshdesk side by side.

## Phase log

Add one entry after each phase: date, what was done, what was found, open points.

| Date | Phase | Notes |
|---|---|---|
| 2026-11-02 | 0 | Trial account created: `dynrtech.freshdesk.com`. Trial ends about 2026-11-23. Steps 5 to 10 open. Next: get the support address, API key (keep in local `.env` only), and email configuration id. Then turn off the requester "New Ticket Created" notification, send a test email from a member mailbox, and run the curl round trip. Save the ticket and conversation JSON (fake data) in `samples/`. |
| 2026-11-03 | 0 | Done. Support address `support@dynrtech.freshdesk.com`, email configuration id `39000068272`. Domain, key, and id are in the local `src/ulink-api/.env`, with placeholders in `.env.example`. Test ticket 4: the agent reply went out (no failed or pending delivery), and the member reply joined ticket 4 as `incoming: true`. The reply landed in the member Spam folder or was hard to find, so look there first in Phase 3. Samples in `samples/ticket.json` and `samples/conversations.json` (addresses and attachment URLs masked). Open: a member reply with an attachment, for Phase 2. |
| 2026-11-03 | 1 | Code done: `config.freshdesk` block, `fetchNewSubmissions` in `channels/freshdeskChannel.js`, test `tests/freshdeskChannel.test.js`. Live run on dev: tickets 1 to 4 gave 4 cases, the second run saved nothing. Tickets 1 to 3 are the Freshdesk demo tickets. Code review changes: fixed 24-hour window instead of a cursor from the last saved message (a failed ticket was lost), skip saved tickets before the detail call, skip outbound and old tickets, 30-second request timeout, 2-minute cap on `Retry-After`, and email-intake skips with a reason when the Freshdesk domain or key is empty. Open: a second live run after the review changes. |
