const crypto = require("crypto");

const reminderRegistry = new Map();

function createReminder({ companyId, entityType, entityId, recipient, dueAt, subject, message, channel = "email" }) {
  if (!companyId || !entityType || !entityId || !recipient || !dueAt) {
    throw new Error("companyId, entityType, entityId, recipient, and dueAt are required");
  }

  const reminder = {
    id: crypto.randomUUID(),
    companyId: String(companyId),
    entityType: String(entityType),
    entityId: String(entityId),
    recipient: String(recipient),
    dueAt: new Date(dueAt).toISOString(),
    subject: String(subject || "Reminder"),
    message: String(message || ""),
    channel: String(channel).toLowerCase(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  const key = `${reminder.companyId}:${reminder.entityType}:${reminder.entityId}`;
  const current = reminderRegistry.get(key) || [];
  current.push(reminder);
  reminderRegistry.set(key, current);
  return reminder;
}

function listReminders({ companyId, status = null } = {}) {
  const entries = Array.from(reminderRegistry.values()).flat();
  return entries.filter((reminder) => {
    if (companyId && reminder.companyId !== String(companyId)) return false;
    if (status && reminder.status !== String(status)) return false;
    return true;
  });
}

function getDueReminders({ companyId, now = new Date() } = {}) {
  const current = new Date(now).getTime();
  return listReminders({ companyId }).filter((reminder) => reminder.status === "pending" && new Date(reminder.dueAt).getTime() <= current);
}

function markReminderSent(reminderId) {
  let found = null;
  for (const entries of reminderRegistry.values()) {
    const target = entries.find((reminder) => reminder.id === reminderId);
    if (target) {
      target.status = "sent";
      found = target;
      break;
    }
  }
  return found;
}

module.exports = {
  reminderRegistry,
  createReminder,
  listReminders,
  getDueReminders,
  markReminderSent,
};
