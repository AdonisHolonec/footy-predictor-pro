/**
 * Creează conturi test (user + admin) pentru UI testing și afișează credențialele.
 * Al doilea contul e promovat la admin via service_role.
 *
 * Usage: node --env-file=.env.local tests/seed_test_accounts.js
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const PASSWORD = "TestUI1234!secure";
const userEmail = `footyui-user-${Math.random().toString(36).slice(2, 8)}@mailinator.com`;
const adminEmail = `footyui-admin-${Math.random().toString(36).slice(2, 8)}@mailinator.com`;

async function seed(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  const uid = data.user.id;
  await new Promise((r) => setTimeout(r, 300));
  if (role === "admin") {
    const { error: roleErr } = await admin
      .from("profiles")
      .update({ role: "admin" })
      .eq("user_id", uid);
    if (roleErr) throw new Error(`role update(${email}): ${roleErr.message}`);
  }
  return uid;
}

(async () => {
  const userId = await seed(userEmail, "user");
  const adminId = await seed(adminEmail, "admin");
  console.log(JSON.stringify({
    user: { email: userEmail, password: PASSWORD, id: userId, role: "user" },
    admin: { email: adminEmail, password: PASSWORD, id: adminId, role: "admin" }
  }, null, 2));
})();
