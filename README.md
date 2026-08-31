# IPP WEB PLATFORM — Institut Polytechnique LA PAIX

Plateforme numérique officielle — **sobre, institutionnel, blanc + bleu marine, light only** — deux frontends séparés partageant le même backend futur.

## Architecture officielle (Phase 4.5)

```
IPP/
├── public/                 # Source unique site public (P1)
│   ├── index.html
│   ├── about.html
│   ├── news.html
│   ├── events.html
│   ├── results.html
│   ├── documents.html
│   ├── gallery.html
│   └── contact.html
├── admin/                  # Portail admin séparé (P3)
│   ├── login.html
│   ├── dashboard.html
│   ├── publications.html
│   ├── events.html
│   ├── results.html
│   ├── documents.html
│   ├── gallery.html
│   ├── users.html
│   └── activity.html
├── css/ variables.css, global.css, public.css, admin.css, responsive.css
├── js/
│   ├── config/app.config.js      # useMock central (P12)
│   ├── services/                 # Seul point de données (P12)
│   │   ├── authService.js        # MOCK ONLY (P4) + hasRole (P5)
│   │   ├── resultsService.js     # searchStudentResult ciblé (P6-7)
│   │   ├── excelService.js       # Abstraction import (P9)
│   │   ├── newsService.js, eventService.js, documentService.js, galleryService.js, notificationService.js
│   ├── public/results.js         # textContent only (P2)
│   ├── admin/adminLayout.js
│   └── shared/ layout.js, validation.js (P13)
├── assets/images/
├── docs/csp-policy.md            # CSP future (P11)
└── index.html                    # Redirect → public/index.html (évite duplication)
```

**Flux :** `UI → JS UI → Service → Mock (aujourd'hui) → Supabase (demain)` — aucune logique Supabase dans les HTML.

## Mode actuel — MOCK

- `AppConfig.useMock = true`, `supabase.enabled=false`, `anonKey=""`
- `authService.isMock=true` — `localStorage` uniquement pour tests frontend. **Ne jamais considérer comme sécurité.**
- `resultsService.search()` exige `level + serie + ≥2 chars` et limite à 8 — pas de `getAllResults()` côté public.
- `excelService.parseFileName()` convention `NIVEAU_SERIE_SESSION_ANNEE.xlsx` (ex: `TERMINALE_F2_T2_2026.xlsx`) — tolérant si nom hors convention.

## Mode futur — Supabase

```
Supabase
├── Auth (remplace authService mock)
├── PostgreSQL + RLS (super_admin/admin/editor imposés serveur)
├── Storage (Excel/PDF, images optimisées)
├── RPC / fonction sécurisée searchStudentResult (P6)
└── Edge Functions (Excel) si besoin (P9)
```

Remplacer le contenu de `js/services/*` — aucune page à retoucher.

## Auth & Rôles (P4-P5)

- `authService.getCurrentUser() / hasRole(role) / hasAnyRole([...])` — **UI uniquement**, masquage d'options.
- Hiérarchie `editor(1) < admin(2) < super_admin(3)` — `super_admin` tout accès, `admin` gestion générale, `editor` contenu seul.
- **Sécurité réelle = RLS + vérifs serveur**, pas `URL admin différente`.

## Résultats — recherche ciblée (P6-7)

```js
searchStudentResult({ level, className, studentName }) // ex: { level:"Terminale", className:"F2", studentName:"Asi" }
```
- Niveau + classe **obligatoires**, suggestions limitées à 8, min 2 caractères. Jamais de liste complète d'une classe.

## Import Excel (P8-9)

`Création Excel normale → nom convention IPP → Upload → excelService.analyze() → aperçu → validation → publication`
Abstraction `excelService` permet `JS lib` ou `Edge Function` selon fichiers réels — non verrouillé.

## Couleur verte (P10)

Bleu marine + blanc restent primaires. Vert citron `#a3e635/#84cc16` **uniquement** pour `ADMIS` (succès), rouge `#ef4444/#dc2626` pour `Ajourné`. Pas de vert comme couleur principale.

## Validation (P13)

`js/shared/validation.js` — champs requis, extensions `.xlsx/.pdf`, taille ≤8 Mo, dates. Frontend ≠ sécurité.

## CSP (P11)

Voir `docs/csp-policy.md` — draft avec `connect-src https://*.supabase.co`, `img-src https://*.supabase.co` à appliquer au déploiement, pas maintenant.

## Lancer en local (P14)

```powershell
# Depuis IPP/public pour le site public (ou IPP pour voir /public/ )
cd public; python -m http.server 8000  # http://localhost:8000/index.html
# Admin (depuis IPP)
python -m http.server 8000  # http://localhost:8000/admin/login.html
```
Comptes mock: `admin@ipp.tg` / `admin01@ipp.tg` / `editeur@ipp.tg` (tout mdp)

## Vérifications (P14)

- [x] CSS/JS/images OK, navigation public/admin OK, responsive OK, recherche résultats OK, countdown OK, import simulé OK, auth mock OK

## Limites volontaires (non sécurisé pour prod)

- Auth en `localStorage`, pas de RLS, XSS possible si données non sanitizées côté futur backend — sanitization prévue pour HTML riche.
- Pas de backend local, Docker, ou Supabase connecté — phase frontend clean + mock ready + supabase ready.
