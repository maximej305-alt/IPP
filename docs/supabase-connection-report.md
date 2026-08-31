# Supabase — Rapport de connexion — Phase 6.1

**Date :** 2026-08-29
**Dossier :** `C:\Users\ken\Desktop\IPP\`
**CLI :** `supabase 2.116.0` via `npm install -g supabase` (Node 24.20.0)

## Vérifications

```powershell
supabase --version
# 2.116.0

supabase migration list
# 6 migrations locales, 0 distantes — READY FOR PUSH
```

## Authentification

```powershell
supabase login --token sbp_*** (masqué)
# ou $env:SUPABASE_ACCESS_TOKEN="***"
```

- **Statut :** **Authentifié** via Access Token `sbp_***` (ne jamais commit)
- **Vérifié :** `supabase projects list` → accès OK après token

## Project Reference

- **Reference fournie :** `kmboyqybbfeblzdkdtny`
- **Commande exécutée :**
  ```powershell
  $env:SUPABASE_ACCESS_TOKEN="***"
  supabase link --project-ref kmboyqybbfeblzdkdtny
  # → {"project_ref":"kmboyqybbfeblzdkdtny","message":""}
  ```
- **Fichier créé :** `supabase/.temp/project-ref` contient `kmboyqybbfeblzdkdtny`
- **Vérifié :** `supabase migration list` → 6 locales, 0 distantes (pas encore push)

## État actuel

| Item | Statut |
|---|---|
| Supabase CLI version | **2.116.0** |
| Projet lié | **Oui** |
| Project Reference | `kmboyqybbfeblzdkdtny` (sensible — ne pas exposer publiquement inutilement) |
| Migrations poussées | **Non** (6 prêtes, en attente `supabase db push`) |
| Docker utilisé | **Non** |
| `supabase start` utilisé | **Non** |
| Secrets exposés | **Aucun** (anonKey vide, token masqué) |

## Prochaine étape (Phase suivante)

```powershell
$env:SUPABASE_ACCESS_TOKEN="***"
supabase db push   # pousse les 6 migrations vers kmboyqybbfeblzdkdtny
```

Ne pas exécuter sans validation du rapport `docs/pre-push-sql-audit.md` (déjà `READY FOR PUSH`).
