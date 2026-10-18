# Nos listes de cadeaux

Petit site familial pour savoir quoi offrir à qui, sans doublon.

- Site statique (HTML/JS, sans compilation) : `index.html`, `app.js`, `store.js`, `style.css`.
- Données dans Supabase : exécuter `supabase/schema.sql` une fois, puis remplir `config.js` avec l'URL du projet et la clé anon.
- Sans `config.js` rempli, le site tourne en **mode démo** (données gardées dans le navigateur).
- Déploiement : importer le dépôt GitHub dans Vercel (preset « Other », pas de commande de build).

Les règles anti-doublon (un seul donneur pour petit plaisir/abordable, 100 % maximum pour un gros cadeau)
sont garanties par le trigger `check_contribution` de la base.
