# Nonobstant

Serveur de fonds documentaire. Il garde la trace de ce qu'une source disait le jour où elle a été citée, suit la publication des actes administratifs, et expose le tout en API pour que d'autres sites l'affichent.

Le nom vient de l'adverbe des administrations : nonobstant ce qui précède. Une page effacée, un chiffre corrigé sans mention, un démenti : nonobstant, la copie est là, datée et empreintée.

## Deux règles de conception

**Rien que de l'information publique.** Aucune donnée personnelle, aucune donnée de visiteur, aucun identifiant. Le serveur ne contient que des documents déjà publics et ce qu'on peut en dire. Il n'y a donc rien à voler qui ne soit pas déjà en ligne, et les sauvegardes comptent plus que le serveur lui-même.

**Le fonds se remplit comme sous-produit, jamais comme tâche.** Chaque entrée est créée par un travail qui aurait eu lieu de toute façon : la vérification d'une source au moment d'écrire, la lecture quotidienne des recueils d'actes administratifs. Aucune saisie manuelle régulière. Une fonctionnalité qui en demanderait est une fonctionnalité à refaire.

## Le coffre des preuves

À l'archivage d'une source, le serveur garde la copie du document, son empreinte sha256, sa date, son type et sa taille, et en tire un extrait de texte.

La copie complète reste sur le disque du serveur et ne sort qu'avec la clé d'écriture. L'extrait, l'empreinte et la date sont publics. La distinction est volontaire : archiver pour pouvoir prouver est une chose, rediffuser l'oeuvre d'autrui en est une autre. L'extrait suffit à citer, l'empreinte suffit à démontrer que la copie n'a pas bougé.

Une source qui ne répond plus n'est pas oubliée : l'échec est enregistré avec sa date, ce qui situe le moment où elle a disparu.

## Mise en route

Node 22.13 ou plus récent, aucune dépendance à installer.

```sh
API_KEY="une-clé-de-24-caractères-au-moins" node server.js
```

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` | port d'écoute | `8090` |
| `API_KEY` | clé d'écriture ; vide, le serveur est en lecture seule | vide |
| `DATA_DIR` | dossier des données et des copies | `./data` |
| `FETCH_MAX` | taille maximale d'un document archivé | 25 Mo |
| `EXTRACT_MAX` | longueur de l'extrait public | 5000 |

Le paquet `poppler-utils` (commande `pdftotext`) est facultatif. Sans lui, les PDF sont archivés mais pas lus.

## API

Lecture publique, écriture avec l'en-tête `X-API-Key`.

| Appel | Effet |
| --- | --- |
| `GET /api/sante` | état du serveur |
| `POST /api/coffre` | archive une source : `{ url, tag?, title?, force? }` |
| `GET /api/coffre?url=…` | toutes les copies d'une adresse, de la plus récente à la plus ancienne |
| `GET /api/coffre/recent?tag=&limit=` | dernières copies |
| `GET /api/coffre/{id}` | fiche publique d'une copie |
| `GET /api/coffre/{id}/copie` | document complet (clé requise) |

Une source archivée deux fois le même jour n'est pas retéléchargée. Deux copies de contenu identique partagent le même fichier sur le disque.

## Vérifications

```sh
node --test test/*.test.js
npx eslint -c eslint.config.js --no-config-lookup server.js src test tools
```

## Licence

AGPL-3.0-or-later. Voir `LICENSE`.
