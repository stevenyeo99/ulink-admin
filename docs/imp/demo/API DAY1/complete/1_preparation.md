1. call claim submission
{
    "Items": [
        {
            "PlanId": "2147",
            "BankName": "CB Bank",
            "ClaimType": "M",
            "InvoiceID": "NIL",
            "BankAcctNo": "0010600100362042",
            "PayeeEmail": "yuwah.khaing@igt-towers.com",
            "BenefitHead": "OV",
            "BenefitType": "OP",
            "IncurDateTo": "08222026",
            "SymptomDate": "08222026",
            "BankAcctName": "Daw Yu Wah Khaing",
            "ExchangeRate": 1,
            "PresentedAmt": 145000,
            "ProviderCode": null,
            "ProviderName": "DR. TEETH",
            "ReceivedDate": "09152026",
            "ContactNumber": "09778620994",
            "DiagnosisCode": "Z09.9",
            "IncurDateFrom": "08222026",
            "PaymentMethod": null,
            "PaymentCurrency": "MMK",
            "TreatmentCountry": "MYANMAR",
            "DiagnosisCodeDesc": "",
            "PresentedCurrency": "MMK",
            "PaymentExchangeRate": 1,
            "DiagnosisDescription": "check and follow up treatment",
            "ReviseClaimReasonCode": ""
        }
    ],
    "isCSR": "N",
    "MemberRefNo": "8/MAKANA(N)217826",
    "isValidation": "N",
    "TpaCaseNumber": "AYA-CL-26034880",
    "TpaClaimNumber": "CL/YGN/AYH/26027127",
    "ProvPortalCaseNumber": ""
}

2. call submission upload
POST = https://api.ulink.ins-link.com/cl-upload
Form Data
- TpaCaseNumber = AYA-CL-26034880
- file = use the document for this tpa