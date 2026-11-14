const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../../src/db");
const { getTestContext } = require("./helpers");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) process.env.JWT_SECRET=crypto.randomBytes(48).toString("hex");
if (!process.env.MFA_ENCRYPTION_KEY || process.env.MFA_ENCRYPTION_KEY.length < 32 || process.env.MFA_ENCRYPTION_KEY===process.env.JWT_SECRET) process.env.MFA_ENCRYPTION_KEY=crypto.randomBytes(48).toString("hex");
if (!process.env.DOC_VERIFY_SECRET || process.env.DOC_VERIFY_SECRET.length < 32) process.env.DOC_VERIFY_SECRET=crypto.randomBytes(48).toString("hex");
const { app } = require("../../src/index");

function decode(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

function cookieHeader(response) {
  const cookies = response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  return cookies.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}

function csrfToken(cookies) {
  return cookies.match(/(?:^|; )ayawin_csrf_token=([^;]+)/)?.[1] || "";
}

test("POS operators retain their narrow permissions across refresh", async () => {
  const context = await getTestContext();
  const suffix = crypto.randomUUID();
  const password = "Pos-operator-pass-1!";
  const hash = await bcrypt.hash(password, 12);
  const role = (await pool.query("SELECT id FROM erp_roles WHERE company_id=$1 AND name='POS Operator'", [context.companyId])).rows[0];
  const user = (await pool.query(
    `INSERT INTO erp_users(company_id,default_branch_id,role_id,username,email,full_name,status,password_hash)
     VALUES($1,$2,$3,$4,$5,'E2E POS Cashier','active',$6) RETURNING id`,
    [context.companyId,context.branchId,role.id,`cashier-${suffix}`,`cashier-${suffix}@example.test`,hash])).rows[0];
  let server;
  try {
    server = await new Promise((resolve) => { const listener=app.listen(0,"127.0.0.1",()=>resolve(listener)); });
    const base=`http://127.0.0.1:${server.address().port}/api/v1`;
    const login=await fetch(`${base}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json",origin:"http://localhost:5173"},
      body:JSON.stringify({email:`cashier-${suffix}@example.test`,password})});
    assert.equal(login.status,200);
    assert.equal(login.headers.get("access-control-allow-credentials"), "true");
    const origin = "http://localhost:5173";
    const bootstrap=await fetch(`${base}/auth/csrf`,{headers:{origin}});
    assert.equal(bootstrap.status,200);
    assert.equal((await bootstrap.json()).csrf_token.length,43);
    assert.equal(bootstrap.headers.getSetCookie().some((cookie) => /ayawin_csrf_token=.*Path=\//i.test(cookie)),true);
    const originalNodeEnv=process.env.NODE_ENV;
    process.env.NODE_ENV="production";
    try {
      const localOrigin=await fetch(`http://127.0.0.1:${server.address().port}/health`,{headers:{origin:"http://127.0.0.1:39761"}});
      assert.equal(localOrigin.headers.get("access-control-allow-origin"),null);
    } finally {
      if(originalNodeEnv===undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV=originalNodeEnv;
    }
    const session=await login.json();
    const loginCookies=cookieHeader(login);
    assert.ok(loginCookies.includes("ayawin_refresh_token="));
    assert.ok(login.headers.getSetCookie().some((cookie) => /ayawin_refresh_token=.*HttpOnly/i.test(cookie)));
    assert.ok(login.headers.getSetCookie().some((cookie) => /ayawin_csrf_token=.*Path=\//i.test(cookie)));
    assert.equal(Object.hasOwn(session, "refresh_token"), false);
    const original=decode(session.access_token);
    assert.equal(original.session_type,"pos");
    const csrf=csrfToken(loginCookies);
    const csrfRejected=await fetch(`${base}/auth/refresh`,{method:"POST",headers:{cookie:loginCookies,"x-csrf-token":"invalid",origin}});
    assert.equal(csrfRejected.status,403);
    const refresh=await fetch(`${base}/auth/refresh`,{method:"POST",headers:{cookie:loginCookies,"x-csrf-token":csrf,origin}});
    assert.equal(refresh.status,200);
    const refreshed=await refresh.json();
    assert.equal(Object.hasOwn(refreshed, "refresh_token"), false);
    const refreshedCookies=cookieHeader(refresh);
    const renewed=decode(refreshed.access_token);
    assert.equal(renewed.session_type,"pos");
    assert.deepEqual([...renewed.permissions].sort(),[
      "master_data.view",
      "sales.create",
      "sales.delivery.post",
      "sales.invoice.create",
      "sales.order.create",
      "sales.receipt.create",
      "sales.view",
    ]);
    const checkoutPermission = await fetch(`${base}/sales/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshed.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(checkoutPermission.status, 400, "POS token should reach order validation rather than be forbidden");
    const mfaSetup=await fetch(`${base}/auth/mfa/setup`,{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({})});
    assert.equal(mfaSetup.status,401);
    const replay=await fetch(`${base}/auth/refresh`,{method:"POST",headers:{cookie:loginCookies,"x-csrf-token":csrf,origin}});
    assert.equal(replay.status,401);
    const familyRevoked=await fetch(`${base}/auth/refresh`,{method:"POST",headers:{cookie:refreshedCookies,"x-csrf-token":csrfToken(refreshedCookies),origin}});
    assert.equal(familyRevoked.status,401);
    const malformed=await fetch(`${base}/finance/journals/not-a-uuid`,{headers:{Authorization:`Bearer ${session.access_token}`}});
    assert.equal(malformed.status,400);
    for(const endpoint of ["/finance/journals","/users","/payroll/runs"]){
      const response=await fetch(`${base}${endpoint}`,{headers:{Authorization:`Bearer ${session.access_token}`}});
      assert.equal(response.status,403,`${endpoint} should be forbidden to a cashier`);
    }
    const unknown=await fetch(`${base}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({email:`unknown-${suffix}@example.test`,password})});
    assert.equal(unknown.status,401);
    const health=await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(health.status,200);
  } finally {
    if(server) await new Promise((resolve)=>server.close(resolve));
    await pool.query("DELETE FROM erp_refresh_tokens WHERE user_id=$1",[user.id]);
    await pool.query("DELETE FROM erp_users WHERE id=$1",[user.id]);
  }
});
