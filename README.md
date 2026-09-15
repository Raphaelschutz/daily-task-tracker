# Daily Task Tracker

PWA mobile minimaliste : tâches du jour, temps passé, rapport de fin de journée envoyé par email en un clic.

- **Front** : `index.html`, `styles.css`, `app.js` — aucun build, installable sur l'écran d'accueil (iOS / Android), fonctionne hors ligne.
- **Backend** : workflow n8n « Daily Task Tracker - API » (`POST /webhook/dtt/report`, `GET /webhook/dtt/history`), Data Tables `dtt_days` et `dtt_tasks`.
- **Réglages** : `config.js` (URL n8n, clé `x-app-key`, destinataire).

## Configuration

`config.js` n'est pas versionné : il contient la clé partagée avec n8n.

```sh
cp config.example.js config.js
```

Puis renseigner `apiBase`, `apiKey` (identique aux nœuds Code du workflow n8n) et `recipient`.

## Déploiement (GitHub Pages)

Le déploiement est automatique : chaque push sur `main` déclenche
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), qui régénère
`config.js` depuis les secrets du dépôt puis publie le site.

Source à régler une seule fois : Settings → Pages → Source → **GitHub Actions**.

Secrets requis (Settings → Secrets and variables → Actions) :

| Secret | Rôle |
| --- | --- |
| `DTT_API_BASE` | URL de base des webhooks n8n |
| `DTT_API_KEY` | clé `x-app-key`, identique aux nœuds Code du workflow |
| `DTT_RECIPIENT` | destinataire du rapport |
| `DTT_HISTORY_LIMIT` | nombre de jours d'historique (défaut 60) |

Site publié : https://raphaelschutz.github.io/daily-task-tracker/ — l'ouvrir sur le
téléphone → Partager → « Sur l'écran d'accueil ».

**À noter** : cette PWA est entièrement côté client. `config.js` est servi au navigateur,
donc `apiKey` reste lisible par tout visiteur du site. La garder hors du dépôt l'expose
moins (les scanners de secrets GitHub ne la voient pas), mais elle ne protège le webhook
que contre les appels automatisés, pas contre quelqu'un qui ouvre les DevTools.


Après chaque modification des fichiers, incrémenter `VERSION` dans `sw.js` pour forcer la mise à jour du cache.
