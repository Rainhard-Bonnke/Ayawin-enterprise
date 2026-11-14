const pool = require("../db");

const VALID_CURRENCY_CODES = new Set([
  "AED",
  "AUD",
  "BIF",
  "BWP",
  "CAD",
  "CHF",
  "CNY",
  "DKK",
  "ETB",
  "EUR",
  "GBP",
  "GHS",
  "INR",
  "JPY",
  "KES",
  "MUR",
  "NGN",
  "NOK",
  "RWF",
  "SDG",
  "SEK",
  "TZS",
  "UGX",
  "USD",
  "ZAR",
  "ZMW",
]);

function normalizeBankAccountInput({
  accountCode,
  accountName,
  currencyCode = "KES",
  isActive = true,
  isPostable = true,
} = {}) {
  const code = String(accountCode || "").trim();
  if (!code) throw new Error("Cash or bank account code is required");
  if (!/^11\d{2,4}$/.test(code)) {
    throw new Error("Cash or bank account code must start with 11 and be an active cash or bank asset code");
  }

  const name = String(accountName || "").trim();
  if (!name) throw new Error("Cash or bank account name is required");

  const currency = String(currencyCode || "KES").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || !VALID_CURRENCY_CODES.has(currency)) {
    throw new Error("Use a valid 3-letter ISO currency code for the cash or bank account");
  }

  return {
    account_code: code,
    account_name: name,
    account_type: "asset",
    level: Math.max(2, code.length - 2),
    currency_code: currency,
    is_active: Boolean(isActive),
    is_postable: Boolean(isPostable),
  };
}

async function listBankAccounts(companyId) {
  const result = await pool.query(
    `SELECT id, account_code, account_name, currency_code, is_active, is_postable
     FROM erp_chart_of_accounts
     WHERE company_id = $1 AND account_type = 'asset' AND account_code LIKE '11%'
       AND is_deleted = FALSE
     ORDER BY account_code`,
    [companyId],
  );
  return result.rows;
}

async function createBankAccount({ companyId, userId, accountCode, accountName, currencyCode, isActive, isPostable }) {
  const normalized = normalizeBankAccountInput({
    accountCode,
    accountName,
    currencyCode,
    isActive,
    isPostable,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM erp_chart_of_accounts
       WHERE company_id = $1 AND account_code = $2 AND is_deleted = FALSE
       FOR UPDATE`,
      [companyId, normalized.account_code],
    );

    if (existing.rowCount) {
      throw new Error(`Cash or bank account ${normalized.account_code} already exists`);
    }

    const result = await client.query(
      `INSERT INTO erp_chart_of_accounts (
         company_id,
         parent_id,
         account_code,
         account_name,
         account_type,
         level,
         is_postable,
         currency_code,
         is_active,
         created_by,
         updated_by
       ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING id, account_code, account_name, account_type, level, is_postable, currency_code, is_active`,
      [
        companyId,
        normalized.account_code,
        normalized.account_name,
        normalized.account_type,
        normalized.level,
        normalized.is_postable,
        normalized.currency_code,
        normalized.is_active,
        userId,
      ],
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  normalizeBankAccountInput,
  listBankAccounts,
  createBankAccount,
};
