'use strict';

// Supports fetching documents that a generated claim PDF references by URL instead of
// embedding (verified against real sample data — incomplete/jd1/1 and incomplete/jd2 both
// link out to as.expa.ai for a medical record / voucher photo that a human reviewer
// clicked through and found fine; the automated pipeline needs to do the same rather than
// treat the document as absent). A fetched linked document is stored as an ordinary
// ulink_email_attachments row (so it's OCR'd the same way and kept as a durable copy
// alongside the rest of the case's evidence) with source_url/parent_attachment_id set to
// distinguish it from a genuine email MIME attachment, where both stay null.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_email_attachments', 'source_url', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('ulink_email_attachments', 'parent_attachment_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'ulink_email_attachments', key: 'id' },
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_email_attachments', 'parent_attachment_id');
    await queryInterface.removeColumn('ulink_email_attachments', 'source_url');
  },
};
