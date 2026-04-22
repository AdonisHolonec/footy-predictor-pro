/**
 * Cleanup test accounts after UI testing.
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

(async () => {
  // List all users with our test pattern and delete them.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    console.error("listUsers error:", error.message);
    process.exit(1);
  }
  const toDelete = (data.users || []).filter(
    (u) =>
      typeof u.email === "string" &&
      (u.email.startsWith("footyui-") || u.email.startsWith("footytest") || u.email.startsWith("footyuitest"))
  );
  console.log(`Found ${toDelete.length} test accounts to delete:`);
  for (const u of toDelete) {
    const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
    console.log(`  - ${u.email}: ${delErr ? "ERROR " + delErr.message : "deleted"}`);
  }
  console.log("Done.");
})();
