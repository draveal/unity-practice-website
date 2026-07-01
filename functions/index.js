/* ==========================================================================
   Unity Practice — Web-Funktionen (Feedback, Email-Abonnenten, Email-Reminder)
   --------------------------------------------------------------------------
   WICHTIG: Der FCM-Push-Versand an die App (reminder_mode t30/t30_t5) läuft
   NICHT hier — das macht das Haupt-App-Repo (admin_v2/functions, Region
   europe-west3, Funktionen `scheduleReminderT30`/`scheduleReminderT5`).
   Dieses Repo (Marketing-Website) ist NUR für die Web-Email-Abonnenten
   zuständig, die kein App-Konto haben (`email_subscribers`-Collection).
   Beide Repos deployen ins selbe Firebase-Projekt `unity-practice-one` —
   FCM-Logik hier zu duplizieren würde zu doppelten Push-Benachrichtigungen
   führen. Bei Änderungen an der Reminder-Logik im Haupt-Repo abstimmen.

   Schema:
     config/app.current_session_id   → aktuelle/nächste Session-ID (optional)
     sessions/{sid}.start_time_utc    → Firestore-Timestamp
     email_subscribers/{sha256(email)} → Web-Abonnenten (kein App-Konto)

   Idempotenz: Pro Session wird die Reminder-Mail genau einmal verschickt —
   gesichert über sessions/{sid}/reminders/email30 (transaktional angelegt).
   So führt das 5-Minuten-Raster nicht zu Doppel-Mails.
   ========================================================================== */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

// Resend-API-Key — als Firebase-Secret gesetzt (NICHT im Code):
//   firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

// Absender + öffentliche Basis-URL der Functions (für Abmelde-Links in Mails).
const MAIL_FROM = 'Unity Practice <onboarding@resend.dev>'; // später: verifizierte Domain
const FUNCTIONS_BASE = 'https://europe-west1-unity-practice-one.cloudfunctions.net';

// Erlaubte Browser-Origins für CORS (Cloudflare Pages + echte Domain + localhost).
// Hosting läuft laut ADR-011 (App-Vault) auf Cloudflare Pages, nicht Netlify —
// Preview-Deploys laufen über zufällige *.pages.dev-Subdomains, die CORS daher
// pauschal erlauben muss (exakte Treffer ODER beliebige *.pages.dev-Domain).
const ALLOWED_ORIGINS = [
  'https://unity-practice.com',
  'https://www.unity-practice.com',
  'http://localhost:8077',
  'http://localhost:5000',
];
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try { return new URL(origin).hostname.endsWith('.pages.dev'); } catch (e) { return false; }
}

admin.initializeApp();
const db = admin.firestore();

// Fenster-Toleranz (Min) um den Soll-Zeitpunkt (30 Min vor Sessionstart).
// Das 5-Min-Raster + Idempotenz-Doc garantieren Exactly-once.
const WINDOW_BEFORE = 1; // bis 1 Min nach dem Soll noch zulässig
const WINDOW_AFTER = 5;  // bis 5 Min vor dem Soll (eine Rasterbreite)

// Lokalisierte Reminder-MAIL-Texte (Abonnenten der Startseite). {min} = Minuten.
const EMAIL_TEXT = {
  de: { subject: 'Erinnerung: Die Praxis beginnt bald', heading: 'Die Praxis beginnt in {min} Minuten', intro: 'Nimm dir gleich einen ruhigen Moment — wir praktizieren gemeinsam.', join: 'Zur Praxis', unsub: 'Abmelden' },
  ru: { subject: 'Напоминание: практика скоро начнётся', heading: 'Практика начнётся через {min} минут', intro: 'Найди спокойный момент — мы практикуем вместе.', join: 'К практике', unsub: 'Отписаться' },
  en: { subject: 'Reminder: the practice begins soon', heading: 'The practice begins in {min} minutes', intro: 'Take a quiet moment now — we practice together.', join: 'Join the practice', unsub: 'Unsubscribe' },
  es: { subject: 'Recordatorio: la práctica comienza pronto', heading: 'La práctica comienza en {min} minutos', intro: 'Tómate un momento de calma — practicamos juntos.', join: 'Unirse a la práctica', unsub: 'Cancelar suscripción' },
};

function reminderEmail(lang, minutes, joinUrl, unsubUrl) {
  const t = EMAIL_TEXT[lang] || EMAIL_TEXT.en;
  const heading = t.heading.replace('{min}', String(minutes));
  const joinBtn = joinUrl
    ? `<p style="margin:24px 0"><a href="${joinUrl}" style="background:#4fc3a1;color:#08263a;text-decoration:none;padding:12px 28px;border-radius:24px;font-weight:600;display:inline-block">${t.join}</a></p>`
    : '';
  const html =
    `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;color:#0a1a2f">` +
    `<h2 style="font-weight:300;color:#0a1a2f">${heading}</h2>` +
    `<p style="font-family:Arial,sans-serif;color:#33506a;line-height:1.6">${t.intro}</p>` +
    joinBtn +
    `<p style="font-family:Arial,sans-serif;font-size:12px;color:#8aa0b5;margin-top:32px">` +
    `<a href="${unsubUrl}" style="color:#8aa0b5">${t.unsub}</a></p></div>`;
  return { subject: t.subject, html };
}

/* Sammelt Kandidaten-Sessions: aktuelle (config/app) + alle kommenden im nächsten
   ~40-Min-Fenster. Dedupliziert per ID. */
async function upcomingSessions(now) {
  const found = new Map();

  // 1) Aktuelle Session laut config/app
  try {
    const cfg = await db.collection('config').doc('app').get();
    const sid = cfg.exists ? cfg.data().current_session_id : null;
    if (sid) {
      const ss = await db.collection('sessions').doc(sid).get();
      if (ss.exists) found.set(ss.id, ss.data());
    }
  } catch (e) { logger.warn('config/app lesen fehlgeschlagen', e); }

  // 2) Alle Sessions, die in den nächsten 40 Min starten
  try {
    const horizon = new Date(now.getTime() + 40 * 60000);
    const q = await db.collection('sessions')
      .where('start_time_utc', '>', admin.firestore.Timestamp.fromDate(now))
      .where('start_time_utc', '<=', admin.firestore.Timestamp.fromDate(horizon))
      .get();
    q.forEach((doc) => { if (!found.has(doc.id)) found.set(doc.id, doc.data()); });
  } catch (e) { logger.error('sessions-Query fehlgeschlagen', e); }

  return found; // Map<sid, data>
}

/* Versucht, die Sende-Sperre für (sid, leadKey) zu setzen. true = wir dürfen senden,
   false = bereits gesendet (oder paralleler Lauf war schneller). */
async function claimReminder(sid, leadKey) {
  const ref = db.collection('sessions').doc(sid).collection('reminders').doc(leadKey);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, { sent_at: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
  } catch (e) {
    logger.warn(`claimReminder ${sid}/${leadKey} fehlgeschlagen`, e);
    return false;
  }
}

/* Aktive E-Mail-Abonnenten (Startseiten-Formular). */
async function emailSubscribers() {
  const out = [];
  try {
    const q = await db.collection('email_subscribers').where('active', '==', true).get();
    q.forEach((doc) => {
      const s = doc.data() || {};
      if (s.email) out.push({ id: doc.id, email: s.email, lang: (s.lang || 'en').slice(0, 2), token: s.token || doc.id });
    });
  } catch (e) { logger.error('email_subscribers-Query fehlgeschlagen', e); }
  return out;
}

/* Ein einzelnes Resend-Mail senden. Gibt true/false zurück. */
async function resendSend(apiKey, { to, subject, html, replyTo }) {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html, reply_to: replyTo }),
    });
    if (!resp.ok) { logger.warn('Resend non-ok', await resp.text()); return false; }
    return true;
  } catch (e) { logger.error('Resend-Fehler', e); return false; }
}

/* Reminder-Mails an alle aktiven Abonnenten (30 Min vor der Session).
   Versand in Batches statt streng sequentiell, damit eine wachsende
   Abonnentenliste nicht das Function-Timeout reißt (siehe timeoutSeconds
   oben — beides zusammen gibt deutlich mehr Spielraum als rein sequentiell). */
const SEND_BATCH_SIZE = 20;
async function sendReminderEmails(sess, minutes, apiKey) {
  const subs = await emailSubscribers();
  if (!subs.length) return { sent: 0 };
  const joinUrl = (sess && (sess.stream_url || sess.audio_url || sess.telegram_youtube_url)) || '';
  let sent = 0;
  for (let i = 0; i < subs.length; i += SEND_BATCH_SIZE) {
    const batch = subs.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.all(batch.map((s) => {
      const unsubUrl = `${FUNCTIONS_BASE}/unsubscribe?token=${encodeURIComponent(s.token)}`;
      const { subject, html } = reminderEmail(s.lang, minutes, joinUrl, unsubUrl);
      return resendSend(apiKey, { to: s.email, subject, html });
    }));
    sent += results.filter(Boolean).length;
  }
  return { sent };
}

exports.emailReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Etc/UTC',
    region: 'europe-west1',
    retryCount: 0,
    secrets: [RESEND_API_KEY],
    timeoutSeconds: 300,
  },
  async () => {
    const now = new Date();
    const sessions = await upcomingSessions(now);
    if (!sessions.size) { logger.info('Keine bevorstehenden Sessions.'); return; }

    for (const [sid, data] of sessions) {
      const start = data && data.start_time_utc && typeof data.start_time_utc.toDate === 'function'
        ? data.start_time_utc.toDate()
        : (data && data.start_time_utc ? new Date(data.start_time_utc) : null);
      if (!start) continue;

      const minutesUntil = (start.getTime() - now.getTime()) / 60000;
      const minLeft = Math.max(1, Math.round(minutesUntil));

      // Reminder-MAIL an Startseiten-Abonnenten (nur einmal, ~30 Min vorher)
      const emailWithin = minutesUntil <= (30 + WINDOW_BEFORE) && minutesUntil > (30 - WINDOW_AFTER);
      if (emailWithin && await claimReminder(sid, 'email30')) {
        const apiKey = RESEND_API_KEY.value();
        if (apiKey) {
          const { sent } = await sendReminderEmails(data, minLeft, apiKey);
          logger.info(`Reminder-Mails für Session ${sid}: ${sent} gesendet.`);
        } else {
          logger.warn('RESEND_API_KEY fehlt — keine Reminder-Mails gesendet.');
        }
      }
    }
  }
);

/* Setzt die CORS-Header (gemeinsam von den HTTP-Functions genutzt). */
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

/* ==========================================================================
   E-Mail-Erinnerung abonnieren (Startseiten-Formular)
   Endpoint:  POST  <base>/subscribeEmail   Body: { email, lang, consent }
   Schreibt nach Firestore email_subscribers/{sha256(email)} (server-seitig →
   kein offener Firestore-Write). Doppelte E-Mails werden re-aktiviert.
   ========================================================================== */
function validEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

exports.subscribeEmail = onRequest(
  { region: 'europe-west1', cors: false },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const data = (typeof req.body === 'object' && req.body) || {};
    const email = String(data.email || '').trim().toLowerCase();
    const lang = String(data.lang || 'en').slice(0, 2);
    if (!validEmail(email)) { res.status(400).json({ error: 'Ungültige E-Mail' }); return; }
    if (data.consent !== true) { res.status(400).json({ error: 'Einwilligung fehlt' }); return; }

    try {
      const id = crypto.createHash('sha256').update(email).digest('hex');
      const ref = db.collection('email_subscribers').doc(id);
      const snap = await ref.get();
      const token = (snap.exists && snap.data().token) || crypto.randomBytes(16).toString('hex');
      await ref.set({
        email, lang, active: true, consent: true, token,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        created_at: snap.exists ? (snap.data().created_at || admin.firestore.FieldValue.serverTimestamp())
                                : admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      res.status(200).json({ ok: true });
    } catch (e) {
      logger.error('subscribeEmail fehlgeschlagen', e);
      res.status(500).json({ error: String(e) });
    }
  }
);

/* ==========================================================================
   Abmelden (Link in jeder Reminder-Mail)
   Endpoint:  GET  <base>/unsubscribe?token=...
   Setzt active=false; antwortet mit einer kleinen HTML-Bestätigung.
   ========================================================================== */
exports.unsubscribe = onRequest(
  { region: 'europe-west1' },
  async (req, res) => {
    const token = String((req.query && req.query.token) || '');
    const page = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<div style="font-family:Arial,sans-serif;max-width:420px;margin:80px auto;text-align:center;color:#0a1a2f">` +
      `<h2 style="font-weight:300">Unity Practice</h2><p style="color:#33506a">${msg}</p></div>`;
    if (!token) { res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(page('Ungültiger Abmelde-Link.')); return; }
    try {
      const q = await db.collection('email_subscribers').where('token', '==', token).limit(1).get();
      if (q.empty) { res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(page('Dieser Link ist nicht mehr gültig.')); return; }
      await q.docs[0].ref.update({ active: false, unsubscribed_at: admin.firestore.FieldValue.serverTimestamp() });
      res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(page('Du bist abgemeldet. Keine Erinnerungen mehr. · You are unsubscribed.'));
    } catch (e) {
      logger.error('unsubscribe fehlgeschlagen', e);
      res.status(500).set('Content-Type', 'text/html; charset=utf-8').send(page('Es ist ein Fehler aufgetreten.'));
    }
  }
);
