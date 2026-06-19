// ============================================================================
// Unity Practice — Feedback-Endpoint als Supabase Edge Function (Deno).
// Ersetzt die frühere Firebase Cloud Function `feedback` (Blaze-Plan nötig).
// Nimmt { userEmail, category, message } per POST entgegen und schickt das
// Feedback per Resend an FEEDBACK_TO. Der Resend-Key liegt als Function-Secret
// (RESEND_API_KEY) — NICHT im Browser, NICHT im Code.
//
// Deploy (public, ohne JWT-Pflicht — Nutzer sind in Firebase eingeloggt, nicht
// in Supabase):
//   npx supabase functions deploy feedback --no-verify-jwt --project-ref <REF>
//   npx supabase secrets set RESEND_API_KEY=<key> --project-ref <REF>
// ============================================================================

const FEEDBACK_TO = 'draveal99@gmail.com';
const MAIL_FROM = 'Unity Practice <onboarding@resend.dev>'; // später: verifizierte Domain

// Erlaubte Browser-Origins für CORS (echte Domain + Cloudflare-Pages + localhost).
const ALLOWED_ORIGINS = [
  'https://unity-practice.com',
  'https://www.unity-practice.com',
  'http://localhost:8077',
  'http://localhost:5000',
];
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try { return new URL(origin).hostname.endsWith('.pages.dev'); } catch (_e) { return false; }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (isAllowedOrigin(origin)) {
    h['Access-Control-Allow-Origin'] = origin as string;
    h['Vary'] = 'Origin';
  }
  return h;
}

function escHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ));
}

// Best-effort In-Memory-Rate-Limit pro IP (warme Instanz). Nicht über alle
// Edge-Instanzen hinweg garantiert, aber bremst naive Spam-Schleifen. Für
// harte Limits später eine DB-Tabelle/atomaren Counter nutzen.
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 Stunde
const RATE_MAX = 5;
const hits = new Map<string, { windowStart: number; count: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now - cur.windowStart > RATE_WINDOW_MS) {
    hits.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  if (cur.count >= RATE_MAX) return true;
  cur.count++;
  return false;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Zu viele Anfragen, bitte später erneut versuchen.' }), {
      status: 429, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY nicht gesetzt' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let data: Record<string, unknown> = {};
  try { data = await req.json(); } catch (_e) { /* leerer/ungültiger Body */ }

  const userEmail = String(data.userEmail || 'unbekannt');
  const category = String(data.category || 'Feedback');
  const message = String(data.message || '').trim();
  if (!message) {
    return new Response(JSON.stringify({ error: 'Nachricht fehlt' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [FEEDBACK_TO],
        reply_to: /@/.test(userEmail) ? userEmail : undefined,
        subject: 'Unity Practice Feedback: ' + category,
        html:
          '<h3>Neues Feedback erhalten</h3>' +
          '<p><strong>Von:</strong> ' + escHtml(userEmail) + '</p>' +
          '<p><strong>Kategorie:</strong> ' + escHtml(category) + '</p>' +
          '<p><strong>Nachricht:</strong></p>' +
          '<p>' + escHtml(message).replace(/\n/g, '<br>') + '</p>',
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      return new Response(JSON.stringify({ error: 'Resend-Fehler', detail }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
