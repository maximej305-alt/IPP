# Rapport Phase 6.5.2 — Intégration Événements Supabase

**Date :** 2026-08-29
**Module :** `events` — deuxième module métier connecté

## État

```
PHASE 6.5.2 — SUCCESSFUL
```

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `js/services/eventService.js` | Réécrit complet : `getPublishedEvents(limit)`, `getAdminEvents()`, `getEventById()`, `groupedByMonth()`, `createEvent()`, `updateEvent()`, `deleteEvent()`, `getEventState()` (À venir/En cours/Terminé), `mapRow` (event_date→start), `toDbPayload` + validation `end_date >= event_date`, `useMock()` via `isSupabaseEnabled()` |
| `admin/events.html` | `await initAdmin({requiredRole:"editor"})`, `getAdminEvents()` + DOM `createElement`/`textContent`, `createEvent({event_date,end_date})` + validation, `deleteEvent` avec confirm, `status` badge `published/draft` |
| `public/events.html` | `getPublishedEvents` + `groupedByMonth` + `getEventState` pour badge `À venir/En cours/Terminé`, loading `Chargement…`, empty `Aucun événement`, error `Impossible de charger` |
| `public/index.html` | `getPublishedNews(3)` + `getPublishedEvents(10)` tri `En cours` puis `À venir` limit 3, badge `En cours/À venir`, `textContent` |

Aucune migration existante modifiée (0001-0009 intactes).

## Migrations

- **Nouvelle migration :** **Aucune** — table `events` et RLS déjà corrects depuis `0002` et `0005`.
- **Vérifié :** `events` a `event_date, end_date, status, created_by` et RLS `Events public read` (`status='published'`) + `Events editor write` (`has_role('editor')`).

## Service

- `getPublishedEvents(limit=20)` → `select * where status='published' order by event_date asc limit`
- `getAdminEvents()` → `select * order by event_date`
- `createEvent({title,description,event_date,end_date,status})` → `insert` avec `created_by` + validation `title/description/event_date` et `end_date>=event_date`, mapping `active/programmed→published`
- `updateEvent/deleteEvent` → `update/delete` via Supabase
- `getEventState(ev)` → `upcoming/ongoing/past` basé sur `today` vs `event_date/end_date` (si `end_date null` → 1 jour)

## RLS — vérifiée

| Rôle | Lecture | Création | Modification | Suppression |
|---|---|---|---|---|
| `anon` | **Oui** `published` uniquement | **Non** 401 | **Non** | **Non** |
| `editor` | Oui | **Oui** 201 | **Oui** | **Oui** |
| `admin` | Oui (hérite) | Oui | Oui | Oui |
| `super_admin` | Oui | Oui | Oui | Oui |

Basé sur `has_role('editor')` hiérarchique.

## Tests réels (kmboyqybbfeblzdkdtny)

| Test | Méthode | Résultat |
|---|---|---|
| `editor` create `published` | POST `/events` `status=published` | **201 PASS** id `0931bc4e` |
| `editor` create `draft` | `status=draft` | **201 PASS** id `d96711` |
| `anon` read `published` | `GET ?status=published` anon | **200** count 1 (seul published) **PASS** |
| `anon` read `draft` | `GET ?id=draft` anon | **200 0 rows** **PASS** |
| `anon` INSERT | POST anon | **401** bloqué **PASS** |
| `editor` XSS `title="<script>alert('test')</script>"` | POST editor | **201** stocké tel quel, `GET` anon → `title` = `<script>...` **PASS** (textContent, pas d'exécution) |
| `event_date` validation | `end < start` | **throw** `La date de fin doit être...` **PASS** |
| `home` limit | `getPublishedEvents(10)` + tri `ongoing→upcoming` limit 3 | **PASS** |

## XSS

- Test `title="<script>alert('test')</script>"`, `description="<img onerror=alert(1)>"` → stocké, `anon` GET retourne texte brut, frontend `createElement` + `textContent` → **pas d'exécution** ✅

## Nettoyage

- **Créés :** 3 events de test (`published`, `draft`, `XSS`)
- **Supprimés :** 3 via `DELETE` editor **204** → `count 0` vérifié
- **Conservés :** **Aucun** — base propre

## Limites

- **Galerie/Documents/Results** toujours **MOCK**
- **Publication programmée** (`scheduled` + `published_at`) non utilisée pour events (seulement `draft/published`)
- **Images** événements non gérées (pas de `image_path` Storage)
- **Historique** événements terminés conservés (pas d'archivage auto)

**Verdict :** Frontend existant → Service propre → Supabase réel → RLS testée → XSS safe → Nettoyage fait.
