// api/shift-request.js
//
// Vercel serverless function. Receives the shift request from the calculator
// page, emails a confirmation to the client and a full copy to you.
//
// SETUP
//   1. Drop this file at  api/shift-request.js  in a Vercel project.
//      A new, otherwise empty repo is fine.
//   2. In Vercel > Settings > Environment Variables, add:
//        RESEND_API_KEY   your Resend key
//        INTERNAL_EMAIL   where your copy goes, e.g. info@gestiostaff.com
//        FROM_EMAIL       e.g. "GestioStaff <requests@gestiostaff.com>"
//                         (that domain must be verified in Resend)
//   3. Deploy, then put the resulting URL into REQUEST.endpoint on the page.
//
// No dependencies — fetch is built into the Vercel Node runtime.

const ALLOWED_ORIGINS = [
  'https://mihaiarsenii.github.io',   // where the page is actually served from
  'https://www.gestiostaff.com',      // in case the page ever moves onto the domain
  'https://gestiostaff.com'
];

export default async function handler(req, res) {
  // --- CORS: the request comes from Squarespace, not from Vercel ---
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Forbidden' });

  const d = req.body || {};

  // --- Validation: never trust the browser ---
  const bad = [];
  if (!d.company || String(d.company).length > 200) bad.push('company');
  if (!d.contact || String(d.contact).length > 200) bad.push('contact');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(d.email || ''))) bad.push('email');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ''))) bad.push('date');
  if (!Array.isArray(d.lines) || !d.lines.length || d.lines.length > 20) bad.push('lines');
  if (!(Number(d.total) > 0)) bad.push('total');
  if (bad.length) return res.status(400).json({ error: 'Invalid request', fields: bad });

  // --- Formatting ---
  const money = n => '£' + Number(n).toFixed(2);
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hrs = n => (Math.round(Number(n) * 100) / 100).toString();

  const prettyDate = new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const worked = Number(d.hoursPerPerson || 0);
  const chargeable = Number(d.chargeableHours || worked);
  const overnight = d.finish <= d.start ? ' (finishing the next day)' : '';
  const times = d.start + ' – ' + d.finish + overnight +
    (d.breakMinutes ? ', with a ' + d.breakMinutes + '-minute unpaid break' : ', no break');

  const row = (label, value) =>
    '<tr><td style="padding:7px 0;color:#6b7585;width:40%">' + label + '</td>' +
    '<td style="padding:7px 0;color:#1a1d21">' + value + '</td></tr>';

  const detailsTable =
    '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:18px 0">' +
      row('Date', esc(prettyDate)) +
      row('Times', esc(times)) +
      row('Hours per person', hrs(chargeable) + ' chargeable' +
        (chargeable > worked ? ' (' + hrs(worked) + ' worked, minimum charge applied)' : '')) +
      row('Staff', Number(d.staffCount) + ' in total') +
    '</table>';

  const clientLines = d.lines.map(l =>
    '<tr>' +
      '<td style="padding:7px 0">' + esc(l.role) + ' &times; ' + Number(l.qty) + '</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.rate) + '/hr</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.total) + '</td>' +
    '</tr>').join('');

  const totalRow =
    '<tr><td colspan="2" style="padding:10px 0 0;border-top:1px solid #e3e6eb;font-weight:bold">Total, excluding VAT</td>' +
    '<td style="padding:10px 0 0;text-align:right;border-top:1px solid #e3e6eb;font-weight:bold">' + money(d.total) + '</td></tr>';

  const wrap = inner =>
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1d21;max-width:560px">' +
    inner + '</div>';

  // --- The client's copy ---
  const clientHtml = wrap(
    '<p>Hi ' + esc(d.contact) + ',</p>' +
    '<p>Thank you — we have your staffing request for ' + esc(d.company) + '. Here is what you have asked for:</p>' +
    detailsTable +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:18px 0">' +
      clientLines + totalRow +
    '</table>' +
    '<p>Someone from GestioStaff will confirm your staff as soon as possible. If anything above is wrong, ' +
    'or you would like to change it, just reply to this email and we will pick it up from here.</p>' +
    '<p>Best wishes,<br>GestioStaff</p>' +
    '<p style="font-size:13px;color:#6b7585;border-top:1px solid #eceef2;padding-top:14px;margin-top:22px">' +
    'Client rates include holiday pay, employer National Insurance, employer pension contributions and our agency fee. ' +
    'This is an estimate based on the rates you entered, not an invoice, and nothing is booked until we confirm.</p>'
  );

  // --- Your copy ---
  const internalLines = d.lines.map(l =>
    '<tr>' +
      '<td style="padding:7px 0">' + esc(l.role) + ' &times; ' + Number(l.qty) + '</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.pay) + '/hr</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.rate) + '/hr</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.total) + '</td>' +
    '</tr>').join('');

  const nmwFlag = d.belowNMW
    ? '<p style="padding:10px 14px;background:#fdeaea;border-radius:6px;color:#a32020;font-size:14px">' +
      'One or more pay rates are below the National Living Wage. Check before confirming.</p>'
    : '';

  const internalHtml = wrap(
    '<p style="font-weight:bold;font-size:17px;margin-bottom:2px">New shift request — ' + esc(d.company) + '</p>' +
    nmwFlag +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:18px 0">' +
      row('Company', esc(d.company)) +
      row('Contact', esc(d.contact)) +
      row('Email', '<a href="mailto:' + esc(d.email) + '">' + esc(d.email) + '</a>') +
    '</table>' +
    detailsTable +
    '<p style="font-weight:bold;margin:24px 0 6px">Staff requested</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px">' +
      '<tr style="color:#6b7585;font-size:13px">' +
        '<td style="padding:7px 0">Role</td>' +
        '<td style="padding:7px 0;text-align:right">Pay rate</td>' +
        '<td style="padding:7px 0;text-align:right">Charge rate</td>' +
        '<td style="padding:7px 0;text-align:right">Line total</td>' +
      '</tr>' +
      internalLines +
      '<tr><td colspan="3" style="padding:10px 0 0;border-top:1px solid #e3e6eb;font-weight:bold">Total, excluding VAT</td>' +
      '<td style="padding:10px 0 0;text-align:right;border-top:1px solid #e3e6eb;font-weight:bold">' + money(d.total) + '</td></tr>' +
    '</table>' +
    '<p style="font-size:13px;color:#6b7585;margin-top:20px">Reply to this email to reach ' + esc(d.contact) + ' directly.</p>'
  );

  // --- Send both, via Resend ---
  const send = body => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  try {
    const [clientRes, internalRes] = await Promise.all([
      send({
        from: process.env.FROM_EMAIL,
        to: [d.email],
        reply_to: process.env.INTERNAL_EMAIL,
        subject: 'Your staff request for ' + prettyDate,
        html: clientHtml
      }),
      send({
        from: process.env.FROM_EMAIL,
        to: [process.env.INTERNAL_EMAIL],
        reply_to: d.email,
        subject: 'Shift request — ' + d.company + ', ' + prettyDate + ' (' + d.staffCount + ' staff)',
        html: internalHtml
      })
    ]);

    // Your copy is the one that matters — if that failed, the request is lost.
    if (!internalRes.ok) {
      console.error('Internal email failed:', await internalRes.text());
      return res.status(502).json({ error: 'Could not send' });
    }
    if (!clientRes.ok) {
      console.error('Client email failed:', await clientRes.text());
      // You still received it, so treat the request as accepted.
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Send failed:', err);
    return res.status(502).json({ error: 'Could not send' });
  }
}
