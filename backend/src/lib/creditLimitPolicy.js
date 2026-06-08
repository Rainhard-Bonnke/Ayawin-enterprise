function getCreditLimitMode() {
  return String(process.env.CREDIT_LIMIT_ENFORCEMENT || 'block').toLowerCase() === 'warn' ? 'warn' : 'block';
}

function applyCreditLimitCheck(checkResult) {
  if (checkResult.ok) {
    return { ok: true, mode: getCreditLimitMode(), ...checkResult };
  }
  if (getCreditLimitMode() === 'warn') {
    return {
      ...checkResult,
      ok: true,
      warning: true,
      code: 'CREDIT_LIMIT_WARNING',
      message: `Credit limit exceeded (limit ${checkResult.credit_limit}, exposure ${checkResult.exposure})`,
      mode: 'warn',
    };
  }
  const err = new Error(
    `Credit limit exceeded (limit ${checkResult.credit_limit}, exposure ${checkResult.exposure})`,
  );
  err.code = 'CREDIT_LIMIT';
  err.details = checkResult;
  throw err;
}

module.exports = { getCreditLimitMode, applyCreditLimitCheck };
