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

  // A request can cover several days. Older pages send one day at the top level.
  const shifts = Array.isArray(d.shifts) ? d.shifts : [{
    date: d.date, start: d.start, finish: d.finish, breakMinutes: d.breakMinutes,
    hoursPerPerson: d.hoursPerPerson, chargeableHours: d.chargeableHours,
    staffCount: d.staffCount, lines: d.lines, subtotal: d.subtotal
  }];

  // --- Validation: never trust the browser ---
  const bad = [];
  if (!d.company || String(d.company).length > 200) bad.push('company');
  if (!d.contact || String(d.contact).length > 200) bad.push('contact');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(d.email || ''))) bad.push('email');
  if (!shifts.length || shifts.length > 14) bad.push('shifts');
  shifts.forEach((s, i) => {
    if (!s || typeof s !== 'object') { bad.push('shift ' + (i + 1)); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) bad.push('date ' + (i + 1));
    if (!/^\d{2}:\d{2}$/.test(String(s.start || '')) || !/^\d{2}:\d{2}$/.test(String(s.finish || ''))) bad.push('times ' + (i + 1));
    if (!Array.isArray(s.lines) || !s.lines.length || s.lines.length > 20) bad.push('lines ' + (i + 1));
    else if (s.lines.some(l => !l || !l.role || String(l.role).length > 60 || !(Number(l.qty) >= 1))) bad.push('lines ' + (i + 1));
  });
  if (!(Number(d.total) > 0)) bad.push('total');
  // Where the event is: usual venue (older pages send nothing) or a new location
  const loc = d.location && typeof d.location === 'object' ? d.location : {};
  const isNewLocation = loc.type === 'new';
  const venue = isNewLocation ? String(loc.venue || '').trim() : '';
  const address = isNewLocation ? String(loc.address || '').trim() : '';
  if (isNewLocation && (!venue || venue.length > 100 || address.length < 5 || address.length > 300)) bad.push('location');
  // Optional notes from the client (line breaks kept)
  if (d.notes != null && (typeof d.notes !== 'string' || d.notes.length > 1000)) bad.push('notes');
  const notes = typeof d.notes === 'string'
    ? d.notes.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : '';
  if (bad.length) return res.status(400).json({ error: 'Invalid request', fields: bad });

  // --- Formatting ---
  const money = n => '£' + Number(n).toFixed(2);
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hrs = n => (Math.round(Number(n) * 100) / 100).toString();

  const longDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).replace(',', '');   // "Friday 6 November 2026
  const shortDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short'
  });

  const multi = shifts.length > 1;
  const sorted = shifts.map(s => s.date).sort();
  const prettyDate = longDate(shifts[0].date);
  const dateSpan = multi
    ? shifts.length + ' days, ' + shortDate(sorted[0]) + ' – ' + shortDate(sorted[sorted.length - 1]) +
      ' ' + sorted[sorted.length - 1].slice(0, 4)
    : prettyDate;
  const staffShifts = shifts.reduce((a, s) => a + (Number(s.staffCount) || 0), 0);

  const row = (label, value) =>
    '<tr><td style="padding:7px 0;color:#6b7585;width:40%">' + label + '</td>' +
    '<td style="padding:7px 0;color:#1a1d21">' + value + '</td></tr>';

  // A map link the client pasted stays clickable; an address gets a Google Maps search link
  const mapHref = /^https?:\/\//i.test(address) ? address
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
  const locationHtml = isNewLocation
    ? '<strong>' + esc(venue) + '</strong><br>' + (/^https?:\/\//i.test(address) ? '' : esc(address) + '<br>') +
      '<a href="' + esc(mapHref) + '">Open in Google Maps</a>'
    : 'Your usual venue';
  const notesHtml = notes ? esc(notes).replace(/\n/g, '<br>') : '';
  const locationHtmlInternal = isNewLocation ? locationHtml : 'Their usual venue <span style="color:#6b7585">(filled in from their last booking on the New booking page)</span>';

  const dayDetails = s => {
    const worked = Number(s.hoursPerPerson || 0);
    const chargeable = Number(s.chargeableHours || worked);
    const overnight = s.finish <= s.start ? ' (finishing the next day)' : '';
    const times = 'Start shift ' + s.start + ', finish shift ' + s.finish + overnight +
      (Number(s.breakMinutes) ? ', with a ' + Number(s.breakMinutes) + '-minute unpaid break' : ', no break');
    return '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:12px 0">' +
      row('Date', esc(longDate(s.date))) +
      row('Times', esc(times)) +
      row('Hours per person', hrs(chargeable) + ' chargeable' +
        (chargeable > worked ? ' (' + hrs(worked) + ' worked, minimum charge applied)' : '')) +
      row('Staff', Number(s.staffCount) + ' in total') +
    '</table>';
  };

  const dayHeading = (s, i) => multi
    ? '<p style="font-weight:bold;font-size:16px;margin:26px 0 0;padding-top:14px;border-top:1px solid #e3e6eb">Day ' +
      (i + 1) + ' — ' + esc(shortDate(s.date)) + '</p>'
    : '';

  const daySubtotal = (s, span) => multi
    ? '<tr><td colspan="' + span + '" style="padding:8px 0 0;color:#6b7585">Day subtotal</td>' +
      '<td style="padding:8px 0 0;text-align:right;color:#6b7585">' +
      money(Number(s.subtotal) || s.lines.reduce((a, l) => a + Number(l.total || 0), 0)) + '</td></tr>'
    : '';

  const clientLineRows = s => s.lines.map(l =>
    '<tr>' +
      '<td style="padding:7px 0">' + esc(l.role) + ' &times; ' + Number(l.qty) + '</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.rate) + '/hr</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.total) + '</td>' +
    '</tr>').join('');

  // What the staff member gets per hour, holiday pay included. Newer pages send it;
  // older ones only sent the basic pay rate.
  const staffRate = l => Number(l.staff) > 0 ? Number(l.staff) : Number(l.pay || 0) * 1.1207;

  const internalLineRows = s => s.lines.map(l =>
    '<tr>' +
      '<td style="padding:7px 0">' + esc(l.role) + ' &times; ' + Number(l.qty) + '</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(staffRate(l)) + '/hr</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.rate) + '/hr</td>' +
      '<td style="padding:7px 0;text-align:right">' + money(l.total) + '</td>' +
    '</tr>').join('');

  // Totals. The client may have switched VAT on before sending, in which case
  // the email has to show the same figures they saw on the page.
  const vatOn = !!d.vatApplied && Number(d.vat) > 0;
  const subtotal = Number(d.subtotal || d.total);

  const totalsBlock = span =>
    (vatOn
      ? '<tr><td colspan="' + span + '" style="padding:10px 0 0;border-top:1px solid #e3e6eb">Subtotal</td>' +
        '<td style="padding:10px 0 0;text-align:right;border-top:1px solid #e3e6eb">' + money(subtotal) + '</td></tr>' +
        '<tr><td colspan="' + span + '" style="padding:6px 0">VAT at ' + Number(d.vatPct || 20) + '%</td>' +
        '<td style="padding:6px 0;text-align:right">' + money(d.vat) + '</td></tr>' +
        '<tr><td colspan="' + span + '" style="padding:6px 0;font-weight:bold">Total, including VAT</td>' +
        '<td style="padding:6px 0;text-align:right;font-weight:bold">' + money(d.total) + '</td></tr>'
      : '<tr><td colspan="' + span + '" style="padding:10px 0 0;border-top:1px solid #e3e6eb;font-weight:bold">Total, excluding VAT</td>' +
        '<td style="padding:10px 0 0;text-align:right;border-top:1px solid #e3e6eb;font-weight:bold">' + money(d.total) + '</td></tr>');

  const wrap = inner =>
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1d21;max-width:560px">' +
    inner + '</div>';

  // --- The client's copy: branded, in the same style as the GestioStaff worker emails ---
  const C = { ink: '#14161a', muted: '#5d646e', line: '#e4e6ea', gold: '#f8d861', dark: '#0c0d10', goldTxt: '#9a7b00' };
  const FONT = 'font-family:Helvetica,Arial,sans-serif;';
  const PHONE = '+44 7831 979890', TEL = 'tel:+447831979890';
  const dateLong = iso => longDate(iso).replace(',', '');
  const firstName = String(d.contact).trim().split(/\s+/)[0] || 'there';

  const card = (title, inner) =>
    '<tr><td style="padding:6px 18px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + C.line + ';border-radius:12px"><tr>' +
    '<td style="padding:14px 14px;' + FONT + 'color:' + C.ink + ';font-size:15px;line-height:1.5">' +
    '<p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:1.5px;color:' + C.muted + '">' + title + '</p>' +
    inner + '</td></tr></table></td></tr>';
  const crow = (label, value, bold) =>
    '<tr><td style="padding:5px 8px 5px 0;width:80px;vertical-align:top;font-size:13px;color:' + C.muted + '">' + label + '</td>' +
    '<td style="padding:5px 0;font-size:15px' + (bold ? ';font-weight:bold' : '') + '">' + value + '</td></tr>';
  const ctable = rows => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows + '</table>';

  const clientDay = (s, i) => {
    const worked = Number(s.hoursPerPerson || 0);
    const chargeable = Number(s.chargeableHours || worked);
    const overnight = s.finish <= s.start ? ' <span style="color:' + C.muted + ';font-size:13px">(finishes the next day)</span>' : '';
    const brk = Number(s.breakMinutes) ? Number(s.breakMinutes) + ' minutes, unpaid' : 'No break';
    const hoursText = hrs(chargeable) + ' per person' +
      (chargeable > worked ? '<br><span style="font-size:13px;color:' + C.muted + '">' + hrs(worked) + ' worked, minimum charge applied</span>' : '');
    const lines = s.lines.map(l =>
      '<tr><td style="padding:8px 0;border-top:1px solid #eef0f3;vertical-align:top">' + esc(l.role) + ' &times; ' + Number(l.qty) +
        '<br><span style="font-size:13px;color:' + C.muted + '">' + money(l.rate) + '/hr &times; ' + hrs(l.hours || chargeable) + ' hrs</span></td>' +
      '<td style="padding:8px 0;border-top:1px solid #eef0f3;text-align:right;vertical-align:top;font-weight:bold">' + money(l.total) + '</td></tr>').join('');
    const sub = multi
      ? '<tr><td style="padding:8px 0 0;border-top:1px solid #eef0f3;color:' + C.muted + ';font-size:14px">Day ' + (i + 1) + ' total</td>' +
        '<td style="padding:8px 0 0;border-top:1px solid #eef0f3;text-align:right;color:' + C.muted + ';font-size:14px">' +
        money(Number(s.subtotal) || s.lines.reduce((a, l) => a + Number(l.total || 0), 0)) + '</td></tr>'
      : '';
    return card(multi ? 'DAY ' + (i + 1) + ' OF ' + shifts.length : 'YOUR SHIFT',
      ctable(
        crow('Date', esc(dateLong(s.date)), true) +
        crow('Times', esc(s.start) + ' &ndash; ' + esc(s.finish) + overnight) +
        crow('Break', brk) +
        crow('Hours', hoursText)
      ) +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">' + lines + sub + '</table>');
  };

  const clientLocation = isNewLocation
    ? '<p style="margin:0;font-weight:bold">' + esc(venue) + '</p>' +
      (/^https?:\/\//i.test(address) ? '' : '<p style="margin:2px 0 0">' + esc(address) + '</p>') +
      '<p style="margin:6px 0 0"><a href="' + esc(mapHref) + '" style="color:#1d4ed8;text-decoration:underline;font-weight:bold">Open in Google Maps &rarr;</a></p>'
    : '<p style="margin:0">Your usual venue</p>';

  const step = (n, text) =>
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>' +
    '<td style="width:34px;vertical-align:top"><div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:' + C.dark +
    ';color:' + C.gold + ';text-align:center;' + FONT + 'font-size:12px;font-weight:bold">' + n + '</div></td>' +
    '<td style="vertical-align:top;font-size:14px;line-height:1.55;color:' + C.ink + ';padding-top:2px">' + text + '</td></tr></table>';

  const totalBox =
    '<tr><td style="padding:12px 18px 6px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ' + C.gold + ';border-radius:12px;background:#fffdf3"><tr>' +
    '<td style="padding:16px 14px;' + FONT + 'color:' + C.ink + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="font-size:15px;font-weight:bold;vertical-align:bottom">Estimated total' +
      '<br><span style="font-size:13px;font-weight:normal;color:' + C.muted + '">' + staffShifts + (staffShifts === 1 ? ' person' : ' staff') +
      (multi ? ' across ' + shifts.length + ' days' : '') + '</span></td>' +
    '<td style="text-align:right;font-size:24px;font-weight:bold;vertical-align:bottom">' + money(d.total) + '</td></tr></table>' +
    (vatOn ? '<p style="margin:8px 0 0;font-size:13px;color:' + C.muted + '">Includes VAT at ' + Number(d.vatPct || 20) + '%: ' + money(d.vat) + ' (' + money(subtotal) + ' before VAT).</p>' : '') +
    '</td></tr></table></td></tr>';

  const clientHtml =
    '<div style="background:#f5f6f8;padding:16px 0;' + FONT + '">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">We have your staff request. Nothing is booked until we confirm.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid ' + C.line + ';border-radius:14px;overflow:hidden">' +
    // header
    '<tr><td style="background:' + C.dark + ';padding:22px 18px">' +
    '<div style="' + FONT + 'font-size:18px;font-weight:bold;letter-spacing:4px;color:' + C.gold + '">GESTIOSTAFF</div>' +
    '<div style="' + FONT + 'font-size:12px;color:#9aa1ab;letter-spacing:1px;margin-top:4px">Hospitality and events staff, London</div></td></tr>' +
    // intro
    '<tr><td style="padding:24px 18px 8px;' + FONT + 'color:' + C.ink + ';font-size:15px;line-height:1.6">' +
    '<p style="margin:0 0 6px;font-size:12px;font-weight:bold;letter-spacing:1.5px;color:' + C.goldTxt + '">REQUEST RECEIVED</p>' +
    '<h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;color:' + C.ink + '">Thanks, ' + esc(firstName) + '</h1>' +
    '<p style="margin:0 0 6px">We&#39;ve received your staff request for <strong>' + esc(d.company) + '</strong>' +
    (multi ? ', covering ' + shifts.length + ' days' : '') + '. Here&#39;s a summary of what you asked for.</p>' +
    '</td></tr>' +
    card('LOCATION', clientLocation) +
    shifts.map(clientDay).join('') +
    (notes ? card('YOUR NOTES', '<p style="margin:0;font-size:15px;line-height:1.55">' + notesHtml + '</p>') : '') +
    totalBox +
    card('WHAT HAPPENS NEXT',
      step(1, 'We&#39;ll confirm your staff by email as soon as possible. Nothing is booked until then.') +
      step(2, 'Before the event, we&#39;ll send you the crew list with names and photos.') +
      step(3, 'Need to change something? Just reply to this email.')) +
    // phone
    '<tr><td style="padding:12px 18px 6px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;border-radius:12px"><tr>' +
    '<td style="padding:14px 14px;' + FONT + 'font-size:14px;line-height:1.55;color:' + C.ink + '">' +
    '<strong>Last-minute changes or questions?</strong><br>Call Mihai on <a href="' + TEL + '" style="color:' + C.ink + ';font-weight:bold;text-decoration:underline">' + PHONE + '</a>.' +
    '</td></tr></table></td></tr>' +
    // sign-off and small print
    '<tr><td style="padding:18px 18px 20px;' + FONT + 'color:' + C.ink + ';font-size:15px;line-height:1.6">' +
    '<p style="margin:0 0 16px">Kind regards,<br><strong>GestioStaff Team</strong></p>' +
    '<p style="margin:0;font-size:12px;line-height:1.55;color:' + C.muted + '">This is an estimate based on the rate you entered, not an invoice. ' +
    'Your rate covers the staff member&#39;s pay and holiday pay, employer National Insurance and pension, and our fee.</p>' +
    '</td></tr>' +
    // footer
    '<tr><td style="background:#f9fafb;border-top:1px solid ' + C.line + ';padding:16px 18px;' + FONT + 'font-size:12px;line-height:1.7;color:' + C.muted + '">' +
    '<strong style="color:' + C.ink + '">GestioStaff Limited</strong><br>' +
    '<a href="mailto:info@gestiostaff.com" style="color:' + C.muted + '">info@gestiostaff.com</a> &middot; ' +
    '<a href="' + TEL + '" style="color:' + C.muted + '">' + PHONE + '</a> &middot; ' +
    '<a href="https://www.gestiostaff.com" style="color:' + C.muted + '">www.gestiostaff.com</a></td></tr>' +
    '</table></div>';

  // --- Your copy ---
  const nmwFlag = d.belowNMW
    ? '<p style="padding:10px 14px;background:#fdeaea;border-radius:6px;color:#a32020;font-size:14px">' +
      'One or more pay rates are below the National Living Wage. Check before confirming.</p>'
    : '';

  const internalHead =
    '<tr style="color:#6b7585;font-size:13px">' +
      '<td style="padding:7px 0">Role</td>' +
      '<td style="padding:7px 0;text-align:right">Staff get (incl. holiday)</td>' +
      '<td style="padding:7px 0;text-align:right">Client rate</td>' +
      '<td style="padding:7px 0;text-align:right">Line total</td>' +
    '</tr>';

  // Links to open each day on the New booking page (when the request page saved it)
  const requestKey = /^[A-Za-z0-9-]{16,64}$/.test(String(d.requestKey || '')) ? String(d.requestKey) : '';
  const requestIds = Array.isArray(d.requestIds) && d.requestIds.length === shifts.length &&
    d.requestIds.every(id => /^rec[A-Za-z0-9]{14}$/.test(String(id))) ? d.requestIds.map(String) : null;
  const canOpen = !!(requestKey || requestIds);
  const openUrl = i => requestKey
    ? 'https://crew.gestiostaff.com/new-booking?key=' + requestKey + '&day=' + (i + 1)
    : 'https://crew.gestiostaff.com/new-booking?request=' + requestIds[i];
  const openButton = (i, label) => canOpen
    ? '<p style="margin:14px 0 4px"><a href="' + openUrl(i) + '" style="display:inline-block;background:#0c0d10;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">' + label + '</a></p>'
    : '';

  const internalDays = shifts.map((s, i) =>
    dayHeading(s, i) +
    dayDetails(s) +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:0 0 6px">' +
      internalHead + internalLineRows(s) + daySubtotal(s, 3) +
    '</table>' +
    (multi ? openButton(i, 'Open day ' + (i + 1) + ' in New booking →') : '')).join('');

  const internalHtml = wrap(
    '<p style="font-weight:bold;font-size:17px;margin-bottom:2px">New shift request — ' + esc(d.company) +
    (multi ? ' (' + shifts.length + ' days)' : '') + '</p>' +
    nmwFlag +
    (multi ? '' : openButton(0, 'Open in New booking →')) +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:18px 0">' +
      row('Company', esc(d.company)) +
      row('Contact', esc(d.contact)) +
      row('Email', '<a href="mailto:' + esc(d.email) + '">' + esc(d.email) + '</a>') +
      row('Location', locationHtmlInternal) +
      (notes ? row('Notes', '<span style="display:inline-block;background:#fff8db;border-radius:6px;padding:6px 10px">' + notesHtml + '</span>') : '') +
    '</table>' +
    internalDays +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:18px 0">' +
      totalsBlock(3) +
    '</table>' +
    (canOpen ? '<p style="font-size:13px;color:#6b7585;margin-top:20px">The button opens crew.gestiostaff.com/new-booking with this request filled in, including the venue. Check it, add the uniform and duties, then create the booking. It\'s also listed there under Client requests waiting.</p>' : '') +
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
        subject: 'Your staff request for ' + dateSpan,
        html: clientHtml
      }),
      send({
        from: process.env.FROM_EMAIL,
        to: [process.env.INTERNAL_EMAIL],
        reply_to: d.email,
        subject: 'Shift request — ' + d.company + ', ' + dateSpan +
          (multi ? ' (' + staffShifts + ' staff shifts)' : ' (' + staffShifts + ' staff)'),
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
