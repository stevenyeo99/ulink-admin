# Member and policy exclusion events

`POST /api/get_member_policy_events` returns a read-only snapshot of the selected
member's exclusion events and the selected policy period's exclusion events.
Use the existing `/api/*` authentication and integration access configuration.
Content-Type: `application/json`.

## Request

```json
{
  "policyNo": "POL000001",
  "policyEffDate": "2026-01-01",
  "memberNo": "MBR000001"
}
```

- Supply `policyNo` or `policyRefNo`, and `memberNo` or `memberRefNo`.
- When both identifiers for an entity are supplied, both must match.
- Identifiers are trimmed; policy-number hyphens are removed for lookup, matching
  the limit-balance API. Member reference lookup is case-insensitive.
- `policyEffDate` is required in strict `YYYY-MM-DD` format. It must match the
  policy effective date exactly. Unlike the limit-balance lookup, this endpoint
  does not select the nearest policy period.
- The member must have a member plan linked to a plan under that policy. Historical
  and terminated memberships are allowed; an active plan is not required.
- Multiple matching member/policy pairs produce an error rather than an arbitrary selection.

## Success response

Illustrative values:

```json
{
  "success": true,
  "payload": {
    "policyNo": "POL000001",
    "policyRefNo": null,
    "policyEffDate": "2026-01-01",
    "memberNo": "MBR000001",
    "memberRefNo": null,
    "memberEvents": [
      {
        "eventId": "10001",
        "eventDate": "2026-02-15",
        "eventCode": "EVENT_CODE_EXCL",
        "eventDescription": "Member exclusion details."
      }
    ],
    "policyEvents": []
  }
}
```

Both arrays always exist. An empty array means no matching exclusions, not a
missing member/policy. Nullable descriptions, dates, and reference numbers remain
JSON null. Event IDs are strings and are unique within their respective list.
Events are ordered by event date descending (nulls last), then numeric ID descending.

The server fixes `SCMA_OID_EVENT_CODE = 'EVENT_CODE_EXCL'` in both tables. Here
`eventCode` is the stored code-record identifier, not `SY_SYS_CODE.SYS_CODE`.
No code lookup is required, so a missing code-master record does not hide an event.
Member events belong to the member record and have no policy-period column;
all exclusions on the resolved member record are returned. Policy events belong
to the resolved policy record. Events are not limited by event date or repeated
per member plan. This is the current stored list, not a deletion-aware audit feed.

## Failure response

The endpoint follows the existing API's JSON success/error convention:

```json
{
  "success": false,
  "error": "Member not found for the specified policy and effective date."
}
```

Other errors cover malformed JSON/types, missing identifiers, invalid dates,
ambiguous matches, and retrieval failure. Internal exceptions are logged without
returning database details or logging event descriptions.

## Verification

`tests/api/GetMemberPolicyEventsTest.java` is a standalone Java 7/8 test. It checks
endpoint registration, validation, reference identifiers, response serialization,
empty lists, missing/ambiguous membership, and bound SQL query scope using fake
rowsets. It does not execute Oracle SQL.

Before release, run authenticated UAT against the target database with both event
lists populated, each list empty independently, non-exclusion event codes, multiple
member plans, terminated membership, a wrong policy period, and identifiers from
outside the integration's permitted access scope. Confirm that integration access
controls enforce the intended policy/member scope before enabling third-party access.
