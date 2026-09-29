POST = https://api.ulink.ins-link.com/cl-upload

Header
x-api-key = 01d3c3a1-bfcf-4cc7-8c8c-68229d98ad21

Multipart Body
TpaCaseNumber = AYA-CL-26031486
file = {merge all file into pdf for case (pdf, images)}


Response
{
    "status": "success",
    "path": "/home/hcbase/ulink-tr-api/outbox/API-AYA-CL-26031486-01/DAY1_INCOMPLETE_1 AYA-CL-26031486.pdf"
}

Note = this API purpose is do upload into console server, but the barcode itself will not imediately return after upload, so we need a special handling to not proceed next step, unless the barcode is returned to our side for apply barcode during API submission.


the way we retrieve barcode will be like this


GET = localhost:3023/api/barcodes?scanId=API-AYA-CL-26031486

Response = {
    "items": [
        {
            "barcodeId": "VSQ9T11875",
            "createdAt": "2026-09-29T02:18:18.707Z",
            "scanId": "API-AYA-CL-26031486-01"
        }
    ],
    "hasMore": false
}