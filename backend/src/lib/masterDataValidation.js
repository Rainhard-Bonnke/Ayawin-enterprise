const {
  validateKraPin,
  validatePhone,
  validateEmail,
  validatePositiveAmount,
  validateRequiredString,
  validateOptionalString,
  validateCode,
} = require('./validators');

function validatePartyBody(body, { isCustomer } = {}) {
  const next = { ...body };
  const name = validateRequiredString(body.name, isCustomer ? 'Customer name' : 'Vendor name', { maxLength: 200 });
  if (!name.ok) return name;
  next.name = name.value;

  const codeField = isCustomer ? 'customer_code' : 'vendor_code';
  if (body[codeField] !== undefined) {
    const code = validateCode(body[codeField], isCustomer ? 'Customer code' : 'Vendor code');
    if (!code.ok) return code;
    next[codeField] = code.value;
  }

  if (isCustomer) {
    const kra = validateKraPin(body.tax_id, { required: true });
    if (!kra.ok) return kra;
    next.tax_id = kra.value;
  } else if (body.tax_id !== undefined && body.tax_id !== null && body.tax_id !== '') {
    const kra = validateKraPin(body.tax_id, { required: false });
    if (!kra.ok) return kra;
    next.tax_id = kra.value;
  }
  if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
    const phone = validatePhone(body.phone, { required: false });
    if (!phone.ok) return phone;
    next.phone = phone.value;
  }
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    const email = validateEmail(body.email, { required: false });
    if (!email.ok) return email;
    next.email = email.value;
  }
  if (body.credit_limit !== undefined) {
    const cl = validatePositiveAmount(body.credit_limit, 'Credit limit');
    if (!cl.ok) return cl;
    next.credit_limit = cl.value;
  }
  const contact = validateOptionalString(body.contact_name, 'Contact name', { maxLength: 120 });
  if (!contact.ok) return contact;
  if (contact.value) next.contact_name = contact.value;

  return { ok: true, body: next };
}

function validateItemBody(body) {
  const next = { ...body };
  const name = validateRequiredString(body.name, 'Item name', { maxLength: 200 });
  if (!name.ok) return name;
  next.name = name.value;

  if (body.item_code !== undefined) {
    const code = validateCode(body.item_code, 'SKU / item code');
    if (!code.ok) return code;
    next.item_code = code.value;
  }
  if (body.standard_cost !== undefined) {
    const cost = validatePositiveAmount(body.standard_cost, 'Standard cost');
    if (!cost.ok) return cost;
    next.standard_cost = cost.value;
  }
  if (body.reorder_point !== undefined) {
    const rp = validatePositiveAmount(body.reorder_point, 'Reorder point');
    if (!rp.ok) return rp;
    next.reorder_point = rp.value;
  }
  const desc = validateOptionalString(body.description, 'Description', { maxLength: 500 });
  if (!desc.ok) return desc;
  if (desc.value) next.description = desc.value;

  return { ok: true, body: next };
}

function validateEmployeeBody(body, { forCreate = false } = {}) {
  const next = { ...body };
  const fname = validateRequiredString(body.first_name, 'First name', { maxLength: 80 });
  if (!fname.ok) return fname;
  next.first_name = fname.value;
  const lname = validateRequiredString(body.last_name, 'Last name', { maxLength: 80 });
  if (!lname.ok) return lname;
  next.last_name = lname.value;

  if (forCreate || body.employee_code !== undefined) {
    const code = validateCode(body.employee_code, 'Employee code');
    if (!code.ok) return code;
    next.employee_code = code.value;
  }
  if (forCreate || body.hire_date !== undefined) {
    const hire = validateRequiredString(body.hire_date, 'Hire date');
    if (!hire.ok) return hire;
    next.hire_date = hire.value;
  }
  if (forCreate || body.department !== undefined) {
    const dept = validateRequiredString(body.department, 'Department', { maxLength: 80 });
    if (!dept.ok) return dept;
    next.department = dept.value;
  }
  if (forCreate || body.job_title !== undefined) {
    const job = validateRequiredString(body.job_title, 'Job title', { maxLength: 80 });
    if (!job.ok) return job;
    next.job_title = job.value;
  }
  if (forCreate || body.id_number !== undefined) {
    const idn = validateRequiredString(body.id_number, 'ID number', { maxLength: 32 });
    if (!idn.ok) return idn;
    next.id_number = idn.value;
  }
  if (forCreate || body.tax_pin !== undefined) {
    const kra = validateKraPin(body.tax_pin, { required: forCreate });
    if (!kra.ok) return kra;
    next.tax_pin = kra.value;
  }
  if (forCreate || body.basic_salary !== undefined) {
    const sal = validatePositiveAmount(body.basic_salary, 'Basic salary');
    if (!sal.ok) return sal;
    next.basic_salary = sal.value;
  }
  if (body.email !== undefined && body.email) {
    const email = validateEmail(body.email, { required: false });
    if (!email.ok) return email;
    next.email = email.value;
  }
  if (body.hire_date && body.termination_date) {
    const { validateDateRange } = require('./validators');
    const dr = validateDateRange(body.hire_date, body.termination_date, {
      startLabel: 'Hire date',
      endLabel: 'Termination date',
    });
    if (!dr.ok) return dr;
  }
  return { ok: true, body: next };
}

module.exports = { validatePartyBody, validateItemBody, validateEmployeeBody };
