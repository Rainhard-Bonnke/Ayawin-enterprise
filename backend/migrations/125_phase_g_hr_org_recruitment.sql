CREATE TABLE IF NOT EXISTS erp_org_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  parent_id UUID REFERENCES erp_org_departments(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_org_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  department_id UUID REFERENCES erp_org_departments(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  grade TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','vacant','filled','closed')),
  headcount_budget INTEGER NOT NULL DEFAULT 1,
  filled_count INTEGER NOT NULL DEFAULT 0,
  reports_to UUID REFERENCES erp_org_positions(id),
  created_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS erp_manpower_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  requisition_no TEXT NOT NULL,
  position_id UUID REFERENCES erp_org_positions(id),
  department_id UUID REFERENCES erp_org_departments(id),
  requested_by UUID REFERENCES erp_users(id),
  reason TEXT,
  headcount_needed INTEGER NOT NULL DEFAULT 1,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent','critical')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','filled','cancelled')),
  approved_by UUID REFERENCES erp_users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, requisition_no)
);

CREATE TABLE IF NOT EXISTS erp_vacancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  position_id UUID REFERENCES erp_org_positions(id),
  department_id UUID REFERENCES erp_org_departments(id),
  title TEXT NOT NULL,
  description TEXT,
  closing_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','filled')),
  created_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  vacancy_id UUID REFERENCES erp_vacancies(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  cv_url TEXT,
  consent_signed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','screened','shortlisted','rejected','offered','accepted','onboarded')),
  created_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_candidate_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  candidate_id UUID NOT NULL REFERENCES erp_candidates(id),
  scheduled_at TIMESTAMPTZ,
  panel_name TEXT,
  score NUMERIC(5,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_candidate_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  candidate_id UUID NOT NULL REFERENCES erp_candidates(id),
  offer_no TEXT NOT NULL,
  proposed_salary NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','accepted','rejected')),
  approved_by UUID REFERENCES erp_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, offer_no)
);

CREATE TABLE IF NOT EXISTS erp_employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  employee_id UUID NOT NULL REFERENCES erp_employees(id),
  document_type TEXT NOT NULL,
  document_name TEXT,
  file_url TEXT,
  expiry_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_employee_dependants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES erp_companies(id),
  employee_id UUID NOT NULL REFERENCES erp_employees(id),
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  date_of_birth DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_org_departments','erp_org_positions','erp_manpower_requisitions','erp_vacancies','erp_candidates',
    'erp_candidate_interviews','erp_candidate_offers','erp_employee_documents','erp_employee_dependants'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION erp_set_updated_at()', t, t);
  END LOOP;
END $$;
