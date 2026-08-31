# Supabase CLI — Setup Phase 5.2

## Vérification

```powershell
supabase --version
# 2.116.0  (installé via npm le 2026-08-29)
where.exe supabase
# C:\Users\ken\AppData\Roaming\npm\supabase.cmd
```

**Méthode d'installation (Windows, sans Docker) :**
```powershell
npm install -g supabase
```
> Ne pas utiliser `scoop` ici (environnement sans scoop). Officiel : https://supabase.com/docs/guides/local-development/cli/getting-started

## Initialisation locale

Exécuté :

```powershell
cd C:\Users\ken\Desktop\IPP
supabase init
# -> supabase/config.toml créé (project_id = "IPP")
```

**Contenu initial `supabase/config.toml` :** voir fichier (port 54321, schemas public/graphql_public, max_rows 1000).

## Règles respectées

- ❌ `supabase start` **NON exécuté** (exigerait Docker) — conforme consigne Phase 5.2
- Docker **non installé**

## Prochaines étapes (Phase 5.3 — à faire avec le propriétaire)

1. **Authentification CLI** (ouvre navigateur, ne jamais mettre mdp dans le repo) :
   ```powershell
   supabase login
   ```
2. **Récupérer Project Reference** depuis https://supabase.com/dashboard/project/_/settings/general (ne pas inventer)
3. **Lier le projet local** :
   ```powershell
   supabase link --project-ref VOTRE_PROJECT_REF
   ```
4. Vérifier :
   ```powershell
   supabase status --linked
   ```

> Tant que `link` n'est pas fait, les migrations restent locales dans `supabase/migrations/`.

## Version documentée

- CLI : **2.116.0**
- Node : 24.20.0 / npm 11.19.0
- Date : 2026-08-29
