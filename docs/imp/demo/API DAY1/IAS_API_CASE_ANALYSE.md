AI (API) Workflow Job Orchestrator

1. Call API /get_claim_api (for list of api claims)
GET HTTP
/api/get_claim_api

response 
{
    "success": true,
    "payload": {
        "dateFrom": "2026-06-30",
        "dateTo": "2026-06-30",
        "total": 4,
        "claims": [
            {
                "clNo": "2604050015",
                "tpaCaseNumber": "STEVENEVERHILLC58",
                "crtDate": "2026-06-30T14:50:18"
            },
            {
                "clNo": "2604050016",
                "tpaCaseNumber": "STEVENEVERHILLC688",
                "crtDate": "2026-06-30T14:54:56"
            },
            {
                "clNo": "2604050017",
                "tpaCaseNumber": "STEVENEVERHILLC68888",
                "crtDate": "2026-06-30T15:07:45"
            },
            {
                "clNo": "2604050018",
                "tpaCaseNumber": "STEVENEVERHILLC688881",
                "crtDate": "2026-06-30T15:08:28"
            }
        ]
    }
}


2. based on above call {ulink-console-middleware}/api/files/materials?scanId=API-{tpaCaseNumber} & /api/files/download (download material into dedicated folder)

// do retrieve material based on tpaCaseNumber
GET = {ulink-console-middleware}/api/files/materials?scanId=API-AYA-CL-26034880
Response = {
    "items": [
        {
            "barcodeId": "VSQ9N14552",
            "scanId": "API-AYA-CL-26034880-01",
            "createdAt": "2026-09-23T12:44:16.228Z",
            "materials": [
                {
                    "material": "ec4Uw5yawSHi0a6u1sErWzaYeXmI0erDt1puf1VLIpDtaPgWQNbKHxqpj15PqXo5",
                    "originalname": "page-000.jpg",
                    "contentType": "image/jpeg",
                    "length": 121719,
                    "uploadDate": "2026-09-23T12:44:15.544Z"
                },
                {
                    "material": "qOYLs9vguVEYpPaH4AgmmokseKUtk1pbeA9eVh8PZ8laePXGJtddbkhjgc2q3pHj",
                    "originalname": "page-001.jpg",
                    "contentType": "image/jpeg",
                    "length": 93556,
                    "uploadDate": "2026-09-23T12:44:15.651Z"
                },
                {
                    "material": "Cv1PgDZBjm717u6QeVe0HSDWCoxLwAX2zgFBlyScUOkhgUs7ZZaDtozGVkaG1iiP",
                    "originalname": "page-002.jpg",
                    "contentType": "image/jpeg",
                    "length": 93661,
                    "uploadDate": "2026-09-23T12:44:15.740Z"
                },
                {
                    "material": "nvO3d1e474La5aiP4Yx1a3t1wkSe6Eqgv43UumeRQCd2SJzHLZ0zjN0KqTjWDWwL",
                    "originalname": "page-003.jpg",
                    "contentType": "image/jpeg",
                    "length": 108993,
                    "uploadDate": "2026-09-23T12:44:15.834Z"
                },
                {
                    "material": "fAdOfo9QIjpIJAPhx18KCw6virbcm4hM4YXbudNqNk9xi0rCx5NSG83J55LcBPGo",
                    "originalname": "page-004.jpg",
                    "contentType": "image/jpeg",
                    "length": 195234,
                    "uploadDate": "2026-09-23T12:44:15.931Z"
                },
                {
                    "material": "V9g0z6Cnx8myzZ1nyTJWaCMd1z4JTYsduvwXDCj7ECYIREjCp8aX9u0YPYopraaL",
                    "originalname": "page-005.jpg",
                    "contentType": "image/jpeg",
                    "length": 181033,
                    "uploadDate": "2026-09-23T12:44:16.028Z"
                },
                {
                    "material": "46owxUa7fwxjUEWUK8YWw9CytwmZHEvDDGbPVJT2wBUgTPx1UHJ4q5SQ9KZkjNQs",
                    "originalname": "page-006.jpg",
                    "contentType": "image/jpeg",
                    "length": 193574,
                    "uploadDate": "2026-09-23T12:44:16.127Z"
                }
            ]
        }
    ],
    "hasMore": false
}

// do download to dedicated folder for AI API case to proceed
POST = {ulink-console-middleware}/api/files/materials?scanId=API-AYA-CL-26034880
{
    "items": [
        {
            "barcodeId": "VSQ9N14552",
            "scanId": "API-AYA-CL-26034880-01",
            "createdAt": "2026-09-23T12:44:16.228Z",
            "materials": [
                {
                    "material": "ec4Uw5yawSHi0a6u1sErWzaYeXmI0erDt1puf1VLIpDtaPgWQNbKHxqpj15PqXo5",
                    "originalname": "page-000.jpg",
                    "contentType": "image/jpeg",
                    "length": 121719,
                    "uploadDate": "2026-09-23T12:44:15.544Z"
                },
                {
                    "material": "qOYLs9vguVEYpPaH4AgmmokseKUtk1pbeA9eVh8PZ8laePXGJtddbkhjgc2q3pHj",
                    "originalname": "page-001.jpg",
                    "contentType": "image/jpeg",
                    "length": 93556,
                    "uploadDate": "2026-09-23T12:44:15.651Z"
                },
                {
                    "material": "Cv1PgDZBjm717u6QeVe0HSDWCoxLwAX2zgFBlyScUOkhgUs7ZZaDtozGVkaG1iiP",
                    "originalname": "page-002.jpg",
                    "contentType": "image/jpeg",
                    "length": 93661,
                    "uploadDate": "2026-09-23T12:44:15.740Z"
                },
                {
                    "material": "nvO3d1e474La5aiP4Yx1a3t1wkSe6Eqgv43UumeRQCd2SJzHLZ0zjN0KqTjWDWwL",
                    "originalname": "page-003.jpg",
                    "contentType": "image/jpeg",
                    "length": 108993,
                    "uploadDate": "2026-09-23T12:44:15.834Z"
                },
                {
                    "material": "fAdOfo9QIjpIJAPhx18KCw6virbcm4hM4YXbudNqNk9xi0rCx5NSG83J55LcBPGo",
                    "originalname": "page-004.jpg",
                    "contentType": "image/jpeg",
                    "length": 195234,
                    "uploadDate": "2026-09-23T12:44:15.931Z"
                },
                {
                    "material": "V9g0z6Cnx8myzZ1nyTJWaCMd1z4JTYsduvwXDCj7ECYIREjCp8aX9u0YPYopraaL",
                    "originalname": "page-005.jpg",
                    "contentType": "image/jpeg",
                    "length": 181033,
                    "uploadDate": "2026-09-23T12:44:16.028Z"
                },
                {
                    "material": "46owxUa7fwxjUEWUK8YWw9CytwmZHEvDDGbPVJT2wBUgTPx1UHJ4q5SQ9KZkjNQs",
                    "originalname": "page-006.jpg",
                    "contentType": "image/jpeg",
                    "length": 193574,
                    "uploadDate": "2026-09-23T12:44:16.127Z"
                }
            ]
        }
    ],
    "outputDownloadPath": "API-AYA-CL-26034880"
}


3. System do the document checking based on dedicated download path
   
4. email if document checking check list (only if document checking not pass)
   
5. call claim revision api 
 
6. ALWAYS update claim information (barcode, diagnosis, benefit) & set suspense code if required & validate (VIA claim revision API)

7. from the sended email, if customer reply (need to regconise this is API case re-do same processing, but just do the claim revision instead of new claim)


----------------------------------------------------------------------------------------------