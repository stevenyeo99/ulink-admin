'use strict';

// Linked documents (files downloaded from a link in the email body) were stored with the storage's header type,
// application/octet-stream (AYA's Azure storage), so the console offered them as a download and its preview stayed
// blank. fetchLinkedDocument now stores the type that matches the file (2026-11-03). This sets the right type on the
// rows stored before, by their file name, the same way fetchLinkedDocument reads it from the link.
// down: nothing to undo; the old type was wrong.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE ulink_email_attachments
       SET content_type = CASE
         WHEN lower(original_filename) LIKE '%.pdf' THEN 'application/pdf'
         WHEN lower(original_filename) LIKE '%.png' THEN 'image/png'
         ELSE 'image/jpeg'
       END
       WHERE source_url IS NOT NULL
         AND content_type = 'application/octet-stream'
         AND (lower(original_filename) LIKE '%.pdf' OR lower(original_filename) LIKE '%.png'
           OR lower(original_filename) LIKE '%.jpg' OR lower(original_filename) LIKE '%.jpeg')`
    );
  },
  async down() {},
};
