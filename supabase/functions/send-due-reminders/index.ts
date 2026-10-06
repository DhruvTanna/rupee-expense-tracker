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
  const today = localDate(), headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  let sent = 0, skipped = 0, errors = 0;
  async function sendOnce(userId: string, recipientKey: string, email: string, subject: string, html: string) {
    const logPath = `${url}/rest/v1/due_reminder_email_log`;
    const claim = await fetch(logPath, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, reminder_date: today, recipient_key: recipientKey, status: "sending" }) });
    if (claim.status === 409) { skipped++; return; }
    if (!claim.ok) throw new Error(`Could not claim reminder send (${claim.status})`);
    try {
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [email], subject, html }) });
      if (!response.ok) throw new Error(`Email provider rejected the reminder (${response.status}): ${await response.text()}`);
      const query = `?user_id=eq.${encodeURIComponent(userId)}&reminder_date=eq.${today}&recipient_key=eq.${encodeURIComponent(recipientKey)}`;
      const marked = await fetch(logPath + query, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent" }) });
      if (!marked.ok) throw new Error("Email sent but its delivery log could not be updated.");
      sent++;
    } catch (error) {
      const query = `?user_id=eq.${encodeURIComponent(userId)}&reminder_date=eq.${today}&recipient_key=eq.${encodeURIComponent(recipientKey)}`;
      await fetch(logPath + query, { method: "DELETE", headers });
      throw error;
    }
  }
  try {
    const rowsResponse = await fetch(`${url}/rest/v1/rupee_tracker_data?select=user_id,data`, { headers });
    if (!rowsResponse.ok) throw new Error(`Could not read tracker snapshots (${rowsResponse.status})`);
    const rows = await rowsResponse.json();
    for (const row of rows) {
      const data = row.data || {}, settings = data.settings || {};
      const ownerEnabled = settings.emailReminders === true, debtorEnabled = settings.debtorEmailReminders === true;
      if (!ownerEnabled && !debtorEnabled) { skipped++; continue; }
      const reimbursements = data.reimbursements || [], people = new Map((data.people || []).map((p: any) => [String(p.id), p]));
      const due: any[] = [];
      for (const expense of data.expenses || []) for (const share of expense.shares || []) {
        const dueDate = String(share.dueDate || "");
        if (!dueDate || dueDate >= today) continue;
        const paid = reimbursements.filter((r: any) => r.expense === expense.id && String(r.person) === String(share.person)).reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
        const pending = Math.max(0, (Number(share.owed) || 0) - paid);
        if (pending > 0) {
          const person: any = people.get(String(share.person));
          due.push({ person: String(share.person), name: person?.name || "Someone", email: String(person?.email || "").trim(), date: dueDate, expense: expense.description || expense.category || "Shared expense", amount: pending });
        }
      }
      // Apply unallocated payments to the oldest dated shares first, matching the tracker’s person-level outstanding balance.
      const credits = new Map<string, number>();
      for (const r of reimbursements) if (!r.expense && !r.credit) credits.set(String(r.person), (credits.get(String(r.person)) || 0) + (Number(r.amount) || 0));
      for (const item of due.sort((a, b) => a.date.localeCompare(b.date))) {
        const credit = credits.get(item.person) || 0, used = Math.min(credit, item.amount);
        item.amount -= used; credits.set(item.person, credit - used);
      }
      const outstanding = due.filter(x => x.amount > 0);
      if (!outstanding.length) { skipped++; continue; }
      const tableRows = (items: any[]) => items.map(x => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${esc(x.expense)}<br><small>Due ${esc(x.date)}</small></td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${inr(x.amount)}</td></tr>`).join("");
      const appLink = `<p><a href="https://dhruvtanna.github.io/rupee-expense-tracker/">Open Rupee tracker</a></p>`;
      if (ownerEnabled) {
        try {
          const userResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(row.user_id)}`, { headers });
          if (!userResponse.ok) throw new Error("Could not look up the tracker owner email.");
          const user = await userResponse.json(), email = user.email;
          if (!email) throw new Error("Tracker owner has no email address.");
          const total = outstanding.reduce((sum, x) => sum + x.amount, 0);
          const html = `<div style="font-family:Arial,sans-serif;color:#17231f;max-width:600px;margin:auto"><h2>Overdue repayments</h2><p>These shared-expense amounts still show as unpaid in your Rupee tracker.</p><table style="border-collapse:collapse;width:100%">${outstanding.map(x => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${esc(x.name)} · ${esc(x.expense)}<br><small>Due ${esc(x.date)}</small></td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${inr(x.amount)}</td></tr>`).join("")}<tr><td style="padding:10px 8px"><b>Total pending</b></td><td style="padding:10px 8px;text-align:right"><b>${inr(total)}</b></td></tr></table><p>You receive this daily summary because your reminder setting is enabled.</p>${appLink}</div>`;
          await sendOnce(row.user_id, "owner", email, `Overdue repayments · ${inr(total)} pending`, html);
        } catch (error) { console.error("Owner reminder send failed", row.user_id, error); errors++; }
      }
      if (debtorEnabled) {
        const byPerson = new Map<string, any[]>();
        for (const item of outstanding) if (item.email) byPerson.set(item.person, [...(byPerson.get(item.person) || []), item]);
        for (const [personId, items] of byPerson) {
          try {
            const person = people.get(personId), total = items.reduce((sum, x) => sum + x.amount, 0);
            const html = `<div style="font-family:Arial,sans-serif;color:#17231f;max-width:600px;margin:auto"><h2>Repayment reminder</h2><p>${esc(person?.name || "Hello")}, this is a reminder from the person who tracks shared expenses with you. Their tracker shows the following amount(s) as unpaid:</p><table style="border-collapse:collapse;width:100%">${tableRows(items)}<tr><td style="padding:10px 8px"><b>Total pending</b></td><td style="padding:10px 8px;text-align:right"><b>${inr(total)}</b></td></tr></table><p>If you have already paid, please let them know so they can update their tracker.</p>${appLink}<small>This is an automated reminder sent because the tracker owner enabled emails to people who owe them.</small></div>`;
            await sendOnce(row.user_id, `person:${personId}`, items[0].email, `Repayment reminder · ${inr(total)} pending`, html);
          } catch (error) { console.error("Debtor reminder send failed", row.user_id, personId, error); errors++; }
        }
      }
    }
    return reply({ date: today, sent, skipped, errors });
  } catch (error) { console.error("Due reminder job failed", error); return reply({ error: "Reminder job failed. Check function logs." }, 500); }
});

