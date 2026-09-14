 VS + YY(base36) + MM(base36) + DD(base36) + 1 + 4 random digits

  Example for 14 Sep 2026:

  VSQ9E1XXXX

  Where:

  - VS = fixed prefix
  - date parts use uppercase base-36
  - 1 = fixed project code
  - XXXX = four random digits from 0000–9999

 const barcode = [
    "VS",
    new Date().getFullYear().toString().slice(-2),
    String(new Date().getMonth() + 1).toString(36).toUpperCase(),
    new Date().getDate().toString(36).toUpperCase(),
    "1",
    String(Math.floor(Math.random() * 10000)).padStart(4, "0"),
  ].join("")

  Format:

  VS + year(base36) + month(base36) + day(base36) + project code + 4 random digits

  Important: generate the barcode when creating the submission, not when uploading the file. For your demo, preserve PDFs as
  PDFs; only convert them into page images if the demo specifically needs image previews or page-by-page rendering.