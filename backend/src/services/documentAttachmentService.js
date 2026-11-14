const crypto = require("crypto");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const documentAttachmentRegistry = new Map();

function normalizeLargeBlob(blob) {
  if (Buffer.isBuffer(blob)) return blob;
  if (typeof blob === "string") return Buffer.from(blob, "base64");
  if (ArrayBuffer.isView(blob)) return Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob instanceof ArrayBuffer) return Buffer.from(blob);
  return null;
}

function createDocumentAttachment({
  companyId,
  documentType,
  documentId,
  fileName,
  contentType,
  byteSize,
  sha256,
  uploadedBy,
  metadata = {},
  blob,
}) {
  if (!companyId || !documentType || !documentId) {
    throw new Error("companyId, documentType, and documentId are required");
  }

  if (!fileName || !String(fileName).trim()) {
    throw new Error("fileName is required");
  }

  if (!ALLOWED_MIME_TYPES.has(String(contentType || ""))) {
    throw new Error("Attachment content type is not allowed");
  }

  const normalizedBlob = normalizeLargeBlob(blob);
  if (!normalizedBlob || normalizedBlob.length === 0) {
    throw new Error("Attachment content is required");
  }

  const resolvedByteSize = Number(byteSize ?? normalizedBlob.length);
  if (!Number.isFinite(resolvedByteSize) || resolvedByteSize <= 0 || resolvedByteSize !== normalizedBlob.length) {
    throw new Error("Attachment byte size does not match the supplied content");
  }

  const digest = String(sha256 || crypto.createHash("sha256").update(normalizedBlob).digest("hex"));
  if (!/^[a-fA-F0-9]{64}$/.test(digest)) {
    throw new Error("Attachment sha256 must be a 64-character hex digest");
  }

  const attachment = {
    id: crypto.randomUUID(),
    companyId: String(companyId),
    documentType: String(documentType),
    documentId: String(documentId),
    fileName: String(fileName).replace(/[\\/\r\n\0]/g, "_").replace(/[<>:"|?*]/g, "_").trim().slice(0, 180) || "attachment",
    contentType: String(contentType),
    byteSize: resolvedByteSize,
    sha256: digest.toLowerCase(),
    uploadedBy: uploadedBy ? String(uploadedBy) : null,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    createdAt: new Date().toISOString(),
    blob: normalizedBlob,
  };

  const key = `${attachment.companyId}:${attachment.documentType}:${attachment.documentId}`;
  const current = documentAttachmentRegistry.get(key) || [];
  current.push(attachment);
  documentAttachmentRegistry.set(key, current);

  return attachment;
}

function listDocumentAttachments({ companyId, documentType, documentId }) {
  if (!companyId || !documentType || !documentId) {
    throw new Error("companyId, documentType, and documentId are required");
  }
  const key = `${String(companyId)}:${String(documentType)}:${String(documentId)}`;
  return (documentAttachmentRegistry.get(key) || []).map((attachment) => ({
    ...attachment,
    blob: undefined,
  }));
}

function getDocumentAttachment({ companyId, documentType, documentId, attachmentId }) {
  if (!companyId || !documentType || !documentId || !attachmentId) {
    throw new Error("companyId, documentType, documentId, and attachmentId are required");
  }
  const key = `${String(companyId)}:${String(documentType)}:${String(documentId)}`;
  const match = (documentAttachmentRegistry.get(key) || []).find((attachment) => attachment.id === String(attachmentId));
  if (!match) return null;
  return { ...match, blob: undefined };
}

module.exports = {
  ALLOWED_MIME_TYPES,
  documentAttachmentRegistry,
  createDocumentAttachment,
  listDocumentAttachments,
  getDocumentAttachment,
};
