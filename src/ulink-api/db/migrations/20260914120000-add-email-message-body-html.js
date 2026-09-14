'use strict';

// Some real submissions have no MIME attachments at all — the claim documents are only
// referenced as links in the email's HTML body (e.g. a "File Attachments Link:" section).
// bodyText (mailparser's plain-text rendering) already stored on this table strips hrefs
// down to their visible link text, so the actual download URL is unrecoverable from it.
// This captures the raw HTML body so a later step (modules/email-intake/service.js) can
// extract and follow those links — see modules/claim-recognition/linkedDocuments.js's
// extractEmailBodyLinkedDocumentUrls, added alongside this.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_email_messages', 'body_html', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_email_messages', 'body_html');
  },
};
