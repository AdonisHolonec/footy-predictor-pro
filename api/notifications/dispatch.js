import { assertSupabaseConfigured, getSupabaseAdmin } from "../_utils/supabaseAdmin.js";

function isAuthorizedDispatch(req) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers["x-cron-secret"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
    req.query.secret;

  if (secret && provided === secret) return true;
  const host = String(req.headers.host || "");
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  if (origin && host && origin.includes(host)) return true;
  if (referer && host && referer.includes(host)) return true;
  return !secret;
}

function buildEmailHtml(items, type) {
  const title = type === "safe" ? "Safe Picks Alerts" : "Value Bets Alerts";
  const rows = items
    .map((item) => {
      const kick = item.kickoff_at ? new Date(item.kickoff_at).toLocaleString("ro-RO") : "-";
      const confidence = Number(item.recommended_confidence || 0).toFixed(1);
      const pick = item.recommended_pick || "-";
      return `<li><strong>${item.home_team} vs ${item.away_team}</strong> · ${item.league_name} · ${kick} · Pick ${pick} · Confidence ${confidence}%</li>`;
    })
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="color:#065f46">${title}</h2>
      <p>Ai predictii noi care corespund preferintelor tale.</p>
      <ul>${rows}</ul>
      <p style="margin-top:12px;color:#334155">Footy Predictor Notifications</p>
    </div>
  `;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NOTIFY_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    return { ok: false, skipped: true, reason: "Missing RESEND_API_KEY or NOTIFY_FROM_EMAIL." };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject,
      html
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend failed: ${text || response.status}`);
  }
  return { ok: true };
}

async function getUserEmail(supabase, userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  return data?.user?.email || null;
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!isAuthorizedDispatch(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized notifications request." });
  }

  const config = assertSupabaseConfigured();
  if (!config.ok) {
    return res.status(500).json({ ok: false, error: config.error });
  }
  const supabase = getSupabaseAdmin();

  try {
    const hours = Math.max(1, Math.min(Number(req.query.hours || 8), 48));
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, favorite_leagues, notify_safe, notify_value, notify_email, onboarding_completed, is_blocked")
      .eq("is_blocked", false)
      .eq("onboarding_completed", true);
    if (profilesError) throw profilesError;

    const validProfiles = (profiles || []).filter((profile) =>
      Array.isArray(profile.favorite_leagues)
      && profile.favorite_leagues.length > 0
      && profile.notify_email
      && (profile.notify_safe || profile.notify_value)
    );

    const { data: predictions, error: predictionsError } = await supabase
      .from("predictions_history")
      .select("fixture_id, league_id, league_name, home_team, away_team, kickoff_at, recommended_pick, recommended_confidence, raw_payload, saved_at")
      .gte("saved_at", cutoff)
      .limit(800);
    if (predictionsError) throw predictionsError;

    const { data: existingLogs, error: logsError } = await supabase
      .from("notification_dispatch_log")
      .select("user_id, fixture_id, notification_type")
      .gte("created_at", cutoff);
    if (logsError) throw logsError;

    const alreadySent = new Set(
      (existingLogs || []).map((row) => `${row.user_id}:${row.fixture_id}:${row.notification_type}`)
    );

    let usersProcessed = 0;
    let notificationsSent = 0;
    let notificationsSkipped = 0;

    for (const profile of validProfiles) {
      const userId = profile.user_id;
      const leaguesSet = new Set((profile.favorite_leagues || []).map((id) => Number(id)));
      const safeItems = [];
      const valueItems = [];

      for (const item of predictions || []) {
        if (!leaguesSet.has(Number(item.league_id))) continue;
        const isSafe = Number(item.recommended_confidence || 0) >= 70;
        const isValue = Boolean(item.raw_payload?.valueBet?.detected);
        if (isSafe && profile.notify_safe && !alreadySent.has(`${userId}:${item.fixture_id}:safe`)) safeItems.push(item);
        if (isValue && profile.notify_value && !alreadySent.has(`${userId}:${item.fixture_id}:value`)) valueItems.push(item);
      }

      if (!safeItems.length && !valueItems.length) continue;

      const email = await getUserEmail(supabase, userId);
      if (!email) continue;

      usersProcessed += 1;
      const payloads = [];
      try {
        if (safeItems.length) {
          const safeTop = safeItems.slice(0, 6);
          const sent = await sendEmail({
            to: email,
            subject: `Footy Predictor: ${safeTop.length} Safe alerts`,
            html: buildEmailHtml(safeTop, "safe")
          });
          for (const item of safeTop) {
            payloads.push({
              user_id: userId,
              fixture_id: Number(item.fixture_id),
              notification_type: "safe",
              channel: "email",
              status: sent.ok ? "sent" : "skipped",
              detail: sent.reason || null
            });
          }
          if (sent.ok) notificationsSent += safeTop.length;
          else notificationsSkipped += safeTop.length;
        }

        if (valueItems.length) {
          const valueTop = valueItems.slice(0, 6);
          const sent = await sendEmail({
            to: email,
            subject: `Footy Predictor: ${valueTop.length} Value alerts`,
            html: buildEmailHtml(valueTop, "value")
          });
          for (const item of valueTop) {
            payloads.push({
              user_id: userId,
              fixture_id: Number(item.fixture_id),
              notification_type: "value",
              channel: "email",
              status: sent.ok ? "sent" : "skipped",
              detail: sent.reason || null
            });
          }
          if (sent.ok) notificationsSent += valueTop.length;
          else notificationsSkipped += valueTop.length;
        }
      } catch (dispatchError) {
        const errorMessage = dispatchError?.message || "Dispatch failed";
        for (const item of [...safeItems.slice(0, 6), ...valueItems.slice(0, 6)]) {
          payloads.push({
            user_id: userId,
            fixture_id: Number(item.fixture_id),
            notification_type: safeItems.includes(item) ? "safe" : "value",
            channel: "email",
            status: "error",
            detail: errorMessage
          });
        }
      }

      if (payloads.length) {
        const { error: upsertError } = await supabase
          .from("notification_dispatch_log")
          .upsert(payloads, { onConflict: "user_id,fixture_id,notification_type,channel" });
        if (upsertError) throw upsertError;
      }
    }

    return res.status(200).json({
      ok: true,
      usersProcessed,
      notificationsSent,
      notificationsSkipped,
      windowHours: hours
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Notification dispatch failed." });
  }
}
