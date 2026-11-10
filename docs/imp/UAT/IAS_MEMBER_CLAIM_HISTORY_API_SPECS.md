# IAS Member Claim History API

Use this endpoint to list a member’s claims for a coverage period and check whether an incurred date already appears on a claim in that period.

## Request

- **Method and path** `POST /api/get_member_claim_hist`
- **Content type** `application/json`

Use the IAS base URL provided for your environment.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `memberRefNo` | String | Yes | Member reference number in IAS. |
| `meplEffDate` | String | Yes | Date in `YYYY-MM-DD` format. IAS uses it to select coverage active on that date. |

```json
{
  "memberRefNo": "MEM-001234",
  "meplEffDate": "2026-06-15"
}
```

The request date selects the coverage period. For example, if `2026-06-15` selects coverage from January through December 2026, claims incurred throughout that period can be returned.

## Successful response

`payload.claims` contains one entry per claim, sorted newest first by `incurredDate`.

| Claim field | Type | Description |
| --- | --- | --- |
| `claimNo` | String or null | IAS claim number. |
| `tpaCaseNumber` | String or null | TPA case number, when available. |
| `incurredDate` | String | Latest incurred date among the claim’s matching lines, in `YYYY-MM-DD` format. |
| `incurredDates` | Array of strings | All distinct incurred dates from the claim’s matching lines, newest first, in `YYYY-MM-DD` format. |
| `status` | String or null | Current IAS claim status code as stored in IAS. |

```json
{
  "success": true,
  "payload": {
    "memberRefNo": "MEM-001234",
    "meplEffDate": "2026-06-15",
    "claims": [
      {
        "claimNo": "CLM-001",
        "tpaCaseNumber": "TPA-001",
        "incurredDate": "2026-09-01",
        "incurredDates": ["2026-09-01", "2026-06-01"],
        "status": "CL_STATUS_NC"
      },
      {
        "claimNo": "CLM-002",
        "tpaCaseNumber": null,
        "incurredDate": "2026-06-01",
        "incurredDates": ["2026-06-01"],
        "status": "CL_STATUS_NC"
      }
    ]
  }
}
```

### Checking for a matching incurred date

Compare the date you want to check against `incurredDates` in each claim. In the example, `2026-06-01` matches both `CLM-001` and `CLM-002`. Each date appears once within a claim, even if several matching lines share it. The caller performs this comparison using the returned list.

### Coverage found with no claims

```json
{
  "success": true,
  "payload": {
    "memberRefNo": "MEM-001234",
    "meplEffDate": "2026-06-15",
    "claims": []
  }
}
```

## Error response

Check `success` before reading `payload`. If `success` is `false`, `error` contains the reason. Possible errors include an invalid request, no matching coverage, or inputs that match multiple members or policies.

```json
{
  "success": false,
  "error": "No member coverage found for the supplied memberRefNo and meplEffDate."
}
```
