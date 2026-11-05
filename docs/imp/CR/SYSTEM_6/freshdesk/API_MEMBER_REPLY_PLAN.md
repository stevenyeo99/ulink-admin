# API case: member reply through Freshdesk

Created: 2026-11-05. Status: Phases 0 to 3 done. Phase 4 (live test) is next.

## Why

For an API case, ULINK uses one of two ways to get missing documents from the member:

1. The system way. The system sends the documents incomplete email to the member through Freshdesk. The member replies with the documents, and the system reads the reply.
2. The manual way. A person sends the email from the draft on the case page. The person uploads the documents that come back on the case page. This is the current flow.

Today the system can send the email, but it does not use the reply. Email intake stores the reply on the API case. But the API pipeline has no step that acts on it, because `api-reply-intake` is not in `API_STEPS` (`modules/pipeline/service.js`). The member's files also never reach the IAS console, because `api-console-upload` sends only documents with origin `UPLOAD`.

## What already works

- The first member email of an API case creates a Freshdesk outbound ticket. The API email sender saves it on the case thread with `messageId = fd-ticket:<ticketId>`.
- Email intake reads replies on that ticket and saves each one with `references = fd-ticket:<ticketId>`. The thread matcher joins the reply to the API case by that id.
- Email intake never makes a new case from an outbound ticket (`source` 10). A reply on the ticket matches the API case before any case is created. So a member reply never becomes an email case.
- The case-page upload function is `uploadDocuments` (`modules/case-upload/upload.js`). It merges files into one PDF and saves it with origin `UPLOAD`. Then it moves the case to `API_UPLOAD_RECEIVED`. Every later job (recognition, document check, console upload, barcode, revision) already handles that status.
- API case team emails go by SMTP (2026-11-05), so a team email never creates a Freshdesk ticket.

## Phases

| Phase | What | Status |
|-------|------|--------|
| 0 | Owner decisions | Done |
| 1 | A member reply acts as an upload | Done |
| 2 | Read replies with email cases off | Done |
| 3 | Console wording | Done |
| 4 | Live test on dev with Freshdesk | Not started |

After each phase, Claude runs a code review, fixes the findings, and gives the owner a commit message.

## Phase 0: owner decisions

No code. The owner answered all five decisions on 2026-11-05.

1. The option. Decided: the existing switch `apiSendMissingDocumentsEmail` controls both directions. On: the system sends the email through Freshdesk and reads the member's reply. Off: the manual way, as today. There is no second switch, because two switches allow a bad mix. For example, the system sends the email but nobody reads the reply.
2. The member's address. Decided as written: `API_CASE_CUSTOMER_EMAIL` stays one fixed address, because the IAS claim list has no member email. On dev, the test mailbox is enough. Production needs the real member address from IAS member info. This plan does not include that work.
3. The settlement report email of an STP claim. Decided: the `CSR_REPORT` email goes by SMTP. The case usually has no member ticket yet, so by Freshdesk this email creates a new ticket. By SMTP, it never creates a ticket.
4. The review lane. Decided: a member reply waits for the normal API pipeline run. A person's case-page upload still goes to the review lane, because only a person's upload is a person's decision.
5. Waiting cases at a switch change. Decided: replies that came before the switch was turned on are not read. A person handles them by hand.

## Phase 1: a member reply acts as an upload

Goal: a member reply with documents goes through the same path as a case-page upload.

1. Add `api-reply-intake` to `API_STEPS`, before `api-claim-recognition`.
2. Skip the step while `apiSendMissingDocumentsEmail` is off, with a skip reason in the run summary.
3. Take replies at the statuses of the case-page upload (`UPLOADABLE_STATUSES`): `API_NO_DOCUMENTS`, `API_CLAIM_SUSPENDED`, `API_DOCUMENTS_REVIEW` and `API_DOCUMENTS_UNSURE`.
4. For a reply with new files, call `uploadDocuments` with those files and the member as the sender. The case goes to `API_UPLOAD_RECEIVED`, and the existing jobs continue from there.
5. Keep the two existing rules of the job. A file that came before (same content) is not taken again. A reply with no new files gets the last missing documents list again.
6. If `uploadDocuments` refuses the files (for example a Word file, more than 10 files, or more than 20 MB), the case keeps waiting. The team gets an SMTP email that names the reason, and a person handles the reply.
7. Read only replies that came after the system first asked the member for documents (decision 5). The settings table has no reliable time of the switch change, so the owner chose this rule on 2026-11-05. With the switch off, the system emails no member, so no reply is read. Known gap: if the switch goes off and on again during one case, a reply from the off time is read.
8. Send the `CSR_REPORT` email by SMTP (decision 3). In `modules/api-email-sender/service.js`, the sender choice uses `imapSmtpChannel` for `CSR_REPORT`, the same as for team emails.

Tests: a reply with a PDF moves the case to `API_UPLOAD_RECEIVED` with one `UPLOAD` document. A repeated file is not taken again. A reply with no file sends the reminder. A refused file keeps the status and sends the team email. With the switch off, the step does nothing. A reply from before the switch change is not read. On Freshdesk, the `CSR_REPORT` email goes by SMTP (`tests/apiEmailSender.test.js`).

## Phase 2: read replies with email cases off

Goal: if the email flow is switched off, the system still reads member replies for API cases.

1. While `apiSendMissingDocumentsEmail` is on and email cases are off, the API pipeline also runs email intake as the step `api-mailbox-replies`, before `api-reply-intake`. While email cases are on, the email pipeline reads the mailbox, so the API pipeline does not (owner, 2026-11-05).
2. In the API pipeline, email intake runs in a replies-only mode. It stores only replies that join an API case, and makes no new case. Email case replies and API case replies never mix (owner, 2026-11-05).
3. Every other email (a new claim email, a reply to an email case) is left for the email pipeline. Nothing is stored. On IMAP, the message stays unseen. Freshdesk reads the last 24 hours on every run, so it needs no change.
4. The step `api-mailbox-replies` takes the `email-intake` lock, so the two pipelines never read the mailbox at once. The unique index on `(source, external_id)` stops a double store.

Tests: in replies-only mode, a reply to an API case is stored. A new claim email and a reply to an email case are not stored and make no case. On IMAP, a message left for the email pipeline stays unseen. The step skip reasons.

## Phase 3: console wording

1. On System settings, the switch label and help text say that the switch covers sending the email and reading the reply.
2. In `modules/assessment-summary/nextAction.js`, the next-action text changes. If the switch is on, it says that the system reads the member's reply.
3. The case page already shows the email thread, so it needs no change.
4. The console pipeline graph (`ulink-console/src/graph/pipelineGraph.ts`, `API_BLOCKS`) has no box for `api-mailbox-replies` and `api-reply-intake` in the API pipeline. Add them.
5. A member reply PDF shows under the group "Uploaded on the case page" (`ulink-console/src/lib/caseFiles.ts`). Name it as a member reply.

## Phase 4: live test on dev with Freshdesk

Run these steps on dev with `CHANNEL_DRIVER=freshdesk` and `apiSendMissingDocumentsEmail` on.

1. Start an API case with missing documents. Make sure that Freshdesk creates one outbound ticket.
2. Reply to the ticket from the test mailbox with one PDF.
3. Make sure that the case goes to `API_UPLOAD_RECEIVED` and that the PDF reaches the IAS console with a barcode.
4. Make sure that the claim revision runs again.
5. Reply with no file. Make sure that the member gets the missing documents list again.
6. Reply with a Word file. Make sure that the case keeps waiting and that the team gets the SMTP email.
7. Turn the switch off. Make sure that a new reply is not read and that the flow is the same as today.

## Log

| Date | Phase | Note |
|------|-------|------|
| 2026-11-05 | 0 | Plan written for the owner's review. |
| 2026-11-05 | 0 | Owner decisions recorded: one switch, fixed member address on dev, `CSR_REPORT` by SMTP, replies wait for the normal run, old replies not read. |
| 2026-11-05 | 1 | Done. `uploadDocuments` split into `prepareUpload` and `saveUpload`. `runApiJob` takes an optional `save(transaction)`. Refused files send the new `MEMBER_REPLY_REFUSED` team email. An SMTP email after a Freshdesk ticket starts its own chain. Flowchart updated. |
| 2026-11-05 | 2 | Done. Step `api-mailbox-replies` (owner chose the name over `email-intake`): `email-intake` replies-only mode (`matchOrCreateThread` with `create: false`, `leaveUnseen` on IMAP and Freshdesk). API pipeline step runs only while email cases are off. Two console items added to Phase 3. |
| 2026-11-05 | 3 | Done. Settings title and help text, next-action text at `API_NO_DOCUMENTS` / `API_CLAIM_SUSPENDED` with the switch on, graph boxes Mailbox Replies and Member Reply Intake, file group "Member's email reply". Wording approved by the owner. |
