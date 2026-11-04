# Document numbering

`erp_document_sequences` holds one locked counter per company, document type and calendar year. Allocation happens in the document transaction, so rollback also rolls back the counter increment. Existing formatted numbers seed each counter from that year’s highest suffix. Padding and prefix are stored per sequence. Invoices and credit notes carry a `TMP-<uuid>` draft reference; posting assigns the legal number. Database triggers reject hard deletion of numbered invoices and credit notes.

Order, delivery, receipt and journal numbers are allocated as each record is created. Voiding uses the `void` status and audit fields; posted accounting documents require a correcting journal or credit note before voiding.
