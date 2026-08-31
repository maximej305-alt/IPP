# CSP future — IPP — Ne pas appliquer sans ajuster les domaines (P11)

> Objectif : préparer une Content Security Policy qui n'empêchera pas Supabase, Storage, Web Push.

## Ressources externes nécessaires (à valider au déploiement)
- Fonts : `https://fonts.googleapis.com` `https://fonts.gstatic.com`
- Images : `self`, `data:`, Supabase Storage `https://*.supabase.co`
- API : `https://*.supabase.co` `https://*.supabase.in`
- Web Push : à définir selon provider

## Draft CSP (à affiner)
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' https://fonts.googleapis.com 'unsafe-inline';
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://*.supabase.co https://images.unsplash.com;
  connect-src 'self' https://*.supabase.co https://*.supabase.in;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

## Notes
- Ne pas mettre `default-src 'self'` seul sans `connect-src`/`img-src` adaptés → casserait Supabase.
- À appliquer via headers HTTP au déploiement (Vercel/Netlify), pas en meta restrictive qui bloquerait l'évolution.
```
