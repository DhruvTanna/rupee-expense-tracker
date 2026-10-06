const corsHeaders = { "Access-Control-Allow-Origin": "https://dhruvtanna.github.io", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-reminder-secret", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
function reply(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function secretKey(): string | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return keys.default || Object.values(keys)[0] || null; } catch { return null; }
}
function localDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function esc(s: unknown) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
function inr(value: number) { return "₹" + value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("REMINDER_CRON_SECRET");
  if (!expected || req.headers.get("x-reminder-secret") !== expected) return reply({ error: "Not authorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = secretKey(), resendKey = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("REMINDER_FROM");
  if (!url || !key || !resendKey || !from) return reply({ error: "Reminder service is not configured." }, 503);
  const today = localDate();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  try {
    const rowsResponse = await fetch(`${url}/rest/v1/rupee_tracker_data?select=user_id,data`, { headers });
    if (!rowsResponse.ok) throw new Error(`Could not read tracker snapshots (${rowsResponse.status})`);
    const rows = await rowsResponse.json();
    let sent = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      const data = row.data || {};
      if (data.settings?.emailReminders !== true) { skipped++; continue; }
      const reimbursements = data.reimbursements || [], people = new Map((data.people || []).map((p: any) => [String(p.id), p.name || "Someone"]));
      const due: any[] = [];
      for (const expense of data.expenses || []) for (const share of expense.shares || []) {
        const dueDate = String(share.dueDate || "");
        if (!dueDate || dueDate >= today) continue;
        const paid = reimbursements.filter((r: any) => r.expense === expense.id && String(r.person) === String(share.person)).reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
        const pending = Math.max(0, (Number(share.owed) || 0) - paid);
        if (pending > 0) due.push({ person: String(share.person), name: people.get(String(share.person)) || "Someone", date: dueDate, expense: expense.description || expense.category || "Shared expense", amount: pending });
      }
      // Overall payments are unallocated in the tracker; apply them to oldest dated dues to avoid false reminders.
      const credits = new Map<string, number>();
      for (const r of reimbursements) if (!r.expense && !r.credit) credits.set(String(r.person), (credits.get(String(r.person)) || 0) + (Number(r.amount) || 0));
      for (const item of due.sort((a, b) => a.date.localeCompare(b.date))) {
        const credit = credits.get(item.person) || 0, used = Math.min(credit, item.amount);
        item.amount -= used; credits.set(item.person, credit - used);
      }
      const outstanding = due.filter(x => x.amount > 0);
      if (!outstanding.length) { skipped++; continue; }
      const claim = await fetch(`${url}/rest/v1/due_reminder_email_log`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ user_id: row.user_id, reminder_date: today, status: "sending" }) });
      if (claim.status === 409) { skipped++; continue; }
      if (!claim.ok) throw new Error(`Could not claim reminder send (${claim.status})`);
      try {
        const userResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(row.user_id)}`, { headers });
        if (!userResponse.ok) throw new Error("Could not look up reminder recipient.");
        const user = await userResponse.json(), email = user.email;
        if (!email) throw new Error("User has no email address.");
        const total = outstanding.reduce((sum, x) => sum + x.amount, 0);
        const list = outstanding.map(x => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${esc(x.name)} · ${esc(x.expense)}<br><small>Due ${esc(x.date)}</small></td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${inr(x.amount)}</td></tr>`).join("");
        const message = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [email], subject: `Overdue repayments · ${inr(total)} pending`, html: `<div style="font-family:Arial,sans-serif;color:#17231f;max-width:600px;margin:auto"><h2>Overdue repayments</h2><p>These shared-expense amounts still show as unpaid in your Rupee tracker.</p><table style="border-collapse:collapse;width:100%">${list}<tr><td style="padding:10px 8px"><b>Total pending</b></td><td style="padding:10px 8px;text-align:right"><b>${inr(total)}</b></td></tr></table><p>Open your tracker to record any payments you have received.</p><p><a href="https://dhruvtanna.github.io/rupee-expense-tracker/">Open Rupee tracker</a></p><small>You receive this daily summary because email reminders are enabled in tracker Settings.</small></div>` }) });
        if (!message.ok) throw new Error(`Email provider rejected the reminder (${message.status}): ${await message.text()}`);
        await fetch(`${url}/rest/v1/due_reminder_email_log?user_id=eq.${encodeURIComponent(row.user_id)}&reminder_date=eq.${today}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent" }) });
        sent++;
      } catch (error) {
        await fetch(`${url}/rest/v1/due_reminder_email_log?user_id=eq.${encodeURIComponent(row.user_id)}&reminder_date=eq.${today}`, { method: "DELETE", headers });
        console.error("Due reminder send failed", row.user_id, error); errors++;
      }
    }
    return reply({ date: today, sent, skipped, errors });
  } catch (error) { console.error("Due reminder job failed", error); return reply({ error: "Reminder job failed. Check function logs." }, 500); }
});

