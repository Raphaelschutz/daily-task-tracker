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

1. Settings → Pages → Source « Deploy from a branch », branche `main`, dossier `/ (root)`.
2. Ouvrir l'URL Pages sur le téléphone → Partager → « Sur l'écran d'accueil ».

`config.js` étant ignoré par Git, il faut le fournir au déploiement — par exemple via une GitHub Action qui l'écrit depuis un secret de dépôt avant la publication.

**À noter** : cette PWA est entièrement côté client. Quel que soit le mode de déploiement, `config.js` est servi au navigateur, donc `apiKey` est lisible par tout visiteur du site. Elle protège le webhook contre les appels automatisés, pas contre quelqu'un qui ouvre la page. Pour un usage réellement privé, garder le dépôt et le site privés.

Après chaque modification des fichiers, incrémenter `VERSION` dans `sw.js` pour forcer la mise à jour du cache.
