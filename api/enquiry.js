// api/enquiry.js
//
// Vercel serverless function for the "New clients and questions" form on the
// request-staff page. Emails you the enquiry, and sends the client a copy of
// what they sent with a short "we'll be in touch" note and our company details.
//
// Uses the same settings as shift-request.js:
//   RESEND_API_KEY, INTERNAL_EMAIL, FROM_EMAIL

const ALLOWED_ORIGINS = [
  'https://mihaiarsenii.github.io',
  'https://www.gestiostaff.com',
  'https://gestiostaff.com'
];

const COMPANY = {
  name: 'GestioStaff Limited',
  tagline: 'Hospitality and events staff in London',
  email: 'info@gestiostaff.com',
  phone: '+44 7831 979890',
  web: 'www.gestiostaff.com',
  signOff: 'GestioStaff'
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const longDate = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});
const shortDate = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
}).replace(',', '');

// "sam taylor" or "SAM TAYLOR" becomes "Sam Taylor"; mixed case is left as typed.
const tidyName = n => (n === n.toLowerCase() || n === n.toUpperCase())
  ? n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  : n;

// Checks and tidies what the form sent. Returns { data } or { bad: [fields] }.
export function readEnquiry(body) {
  const d = body || {};
  const clean = (v, max) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max);
  const data = {
    name: tidyName(clean(d.name, 120).replace(/\s+/g, ' ')),
    email: clean(d.email, 200),
    date: clean(d.date, 10),
    start: clean(d.start, 5),
    finish: clean(d.finish, 5),
    details: clean(d.details, 2000)
  };
  const bad = [];
  if (!data.name) bad.push('name');
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(data.email)) bad.push('email');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || isNaN(Date.parse(data.date))) bad.push('date');
  if (data.start && !/^\d{2}:\d{2}$/.test(data.start)) bad.push('start');
  if (data.finish && !/^\d{2}:\d{2}$/.test(data.finish)) bad.push('finish');
  return bad.length ? { bad } : { data };
}

// Builds both emails. Kept separate from the handler so they can be previewed.
export function buildEmails(e) {
  const first = e.name.split(' ')[0];
  const firstName = first.charAt(0).toUpperCase() + first.slice(1);

  const row = (label, value) =>
    '<tr><td style="padding:8px 12px 8px 0;color:#6b7585;width:34%;vertical-align:top">' + label + '</td>' +
    '<td style="padding:8px 0;color:#1a1d21;vertical-align:top">' + value + '</td></tr>';

  const times = e.start || e.finish
    ? (e.start ? 'Start ' + e.start : 'Start not given') + ', ' + (e.finish ? 'finish ' + e.finish : 'finish not given') +
      (e.start && e.finish && e.finish <= e.start ? ' (the next day)' : '')
    : 'Not given yet';

  const detailsHtml = e.details
    ? esc(e.details).replace(/\n/g, '<br>')
    : '<span style="color:#6b7585">None added</span>';

  const sent = (emailCell) =>
    '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:6px 0 18px;border-top:1px solid #e3e6eb">' +
      row('Name', esc(e.name)) +
      row('Email', emailCell) +
      row('Event date', esc(longDate(e.date))) +
      row('Times', esc(times)) +
      row('Details', detailsHtml) +
    '</table>';

  const wrap = inner =>
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1d21;max-width:560px">' +
    inner + '</div>';

  const companyBlock =
    '<table style="border-collapse:collapse;margin-top:26px;border-top:1px solid #e3e6eb;width:100%">' +
      '<tr><td style="padding-top:14px;font-size:13px;line-height:1.7;color:#6b7585">' +
        '<strong style="color:#1a1d21;font-size:14px">' + COMPANY.name + '</strong><br>' +
        COMPANY.tagline + '<br>' +
        '<a href="mailto:' + COMPANY.email + '" style="color:#1a1d21">' + COMPANY.email + '</a>' +
        ' &nbsp;·&nbsp; ' + COMPANY.phone +
        ' &nbsp;·&nbsp; <a href="https://' + COMPANY.web + '" style="color:#1a1d21">' + COMPANY.web + '</a>' +
      '</td></tr>' +
    '</table>';

  const client = {
    subject: 'Thanks for your enquiry – GestioStaff',
    html: wrap(
      '<p>Hi ' + esc(firstName) + ',</p>' +
      '<p>Thanks for getting in touch with GestioStaff. We\'ve got your details, and someone from our team ' +
      'will get back to you soon.</p>' +
      '<p style="margin-bottom:4px"><strong>Here\'s what you sent us:</strong></p>' +
      sent(esc(e.email)) +
      '<p>If you\'d like to add anything, just reply to this email.</p>' +
      '<p>Kind regards,<br>' + COMPANY.signOff + '</p>' +
      companyBlock
    )
  };

  const internal = {
    subject: 'New client enquiry – ' + e.name + ', ' + shortDate(e.date),
    html: wrap(
      '<p style="font-weight:bold;font-size:17px;margin-bottom:2px">New client enquiry</p>' +
      '<p style="margin-top:0;color:#6b7585">Sent from the request-staff page.</p>' +
      sent('<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a>') +
      '<p style="font-size:13px;color:#6b7585">Reply to this email to answer ' + esc(firstName) + ' directly. ' +
      'They\'ve been sent a copy of the above.</p>'
    )
  };

  return { client, internal };
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Forbidden' });

  // Hidden field only bots fill in: pretend it worked, send nothing.
  if (req.body && req.body.website) return res.status(200).json({ ok: true });

  const { data, bad } = readEnquiry(req.body);
  if (bad) return res.status(400).json({ error: 'Invalid enquiry', fields: bad });

  const { client, internal } = buildEmails(data);

  const send = body => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  try {
    const [internalRes, clientRes] = await Promise.all([
      send({ from: process.env.FROM_EMAIL, to: [process.env.INTERNAL_EMAIL], reply_to: data.email,
             subject: internal.subject, html: internal.html }),
      send({ from: process.env.FROM_EMAIL, to: [data.email], reply_to: process.env.INTERNAL_EMAIL,
             subject: client.subject, html: client.html })
    ]);

    // Your copy is the one that matters: if it failed, the enquiry is lost.
    if (!internalRes.ok) {
      console.error('Internal email failed:', internalRes.status, await internalRes.text());
      return res.status(502).json({ error: 'Could not send' });
    }
    if (!clientRes.ok) console.error('Client email failed:', clientRes.status, await clientRes.text());

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Send failed:', err && err.message);
    return res.status(502).json({ error: 'Could not send' });
  }
}
