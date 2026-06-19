# Unity Practice — Website

Statische Website für Unity Practice. Hosting via Cloudflare Pages.

## Struktur

| Pfad | Inhalt |
|------|--------|
| `index.html` | Startseite |
| `profil/`, `faq/`, `stimmen/`, `wissenschaft/`, `ueber-samarth/` | Unterseiten |
| `_headers`, `_redirects` | Cloudflare-Pages-Konfiguration (CSP, Cache, Redirects) |
| `manifest.json`, Icons, `favicon.svg` | PWA / Branding |
| `functions/` | Firebase-Functions (Quelle, aktuell nicht deployed) |
| `supabase/functions/` | Supabase Edge Functions (Feedback) |

## Deployment

Statisches Hosting über **Cloudflare Pages** (Root als Output-Verzeichnis, kein Build-Schritt).

## Hinweise

- Interne Setup-Anleitungen liegen lokal und sind via `.gitignore` vom Repo ausgeschlossen.
- Geheime Schlüssel (z. B. `RESEND_API_KEY`) liegen ausschließlich als Function-Secrets, nie im Code.
