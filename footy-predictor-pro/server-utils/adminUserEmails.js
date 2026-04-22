/** Resolve auth user emails for admin views (service role `getUserById`). */
export async function mapUserIdsToEmails(supabaseAdmin, userIds) {
  const map = new Map();
  const unique = [...new Set((userIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!unique.length || !supabaseAdmin?.auth?.admin?.getUserById) return map;

  const batchSize = 12;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const settled = await Promise.all(
      batch.map(async (id) => {
        try {
          const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
          if (error || !data?.user) return { id, email: null };
          const email = typeof data.user.email === "string" ? data.user.email.trim() : "";
          return { id, email: email || null };
        } catch {
          return { id, email: null };
        }
      })
    );
    for (const { id, email } of settled) {
      if (email) map.set(id, email);
    }
  }
  return map;
}
