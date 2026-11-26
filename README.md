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

## La veille des arrêtés

Les 101 sites de préfecture sont relus régulièrement. Les pages utiles de chaque site (accueil, actualités, communiqués, recueil des actes administratifs de l'année et du mois) sont repérées seules une fois par jour, parce que ces sites partagent le même moteur mais pas la même arborescence. Les documents qui apparaissent et dont le titre parle de manifestation, de périmètre, de couvre-feu ou de drones sont téléchargés, versés au coffre, lus, puis transformés en arrêtés structurés : département, commune, début, fin, mesures. Les recueils ont des titres muets (« Recueil spécial n° 331 »), ceux-là sont lus systématiquement.

Chaque arrêté sort dans un de deux états.

**complet** : la zone, la période et au moins une mesure se lisent sans ambiguïté. Publiable tel quel.

**partiel** : il manque quelque chose, et c'est dit (`manque`). Rien n'est complété au jugé. Mieux vaut un arrêté absent qu'un arrêté inventé : dans la rue, une date fausse se paie.

Au premier passage sur une source, tout ce qui s'y trouve déjà sert de référence sans être lu, sinon le premier tour téléchargerait des années de recueils.

Deux limites assumées. Un arrêté visant plusieurs communes donne un arrêté par commune, parce qu'une zone est une commune ou un département. Un couvre-feu de plusieurs nuits ne tient pas dans un seul début et une seule fin : la période couvre alors toute la plage, jusqu'au matin suivant le dernier jour, et la phrase de l'arrêté, citée telle quelle, dit les vrais horaires. Avertir un peu trop largement est le bon sens du risque pour quelqu'un qui est dans la rue.

## La veille des numéros de legal team

Il n'existe aucun registre. Un numéro de legal team est annoncé mobilisation par mobilisation, sur le site d'un collectif antirépression, d'un média local indépendant ou d'un syndicat, et il change d'une manifestation à l'autre. La veille lit les pages qu'on lui donne (`kind: "legal"`) et en tire des candidats, chacun avec son numéro normalisé, la fenêtre de texte qui l'entoure, un indice de rattachement quand la page en donne un, la source et une copie au coffre.

Rien n'est publié tout seul, et ce n'est pas une précaution de principe : un numéro faux envoie quelqu'un en garde à vue appeler le vide. La validation reste humaine.

Un numéro n'est retenu que si son entourage parle d'antirépression (legal team, garde à vue, interpellation, avocat·e, permanence juridique). Sans ce filtre, la veille ramasserait le numéro d'un secrétariat, d'un commerce, ou d'une personne privée citée dans un article voisin.

Un numéro qui disparaît de sa page n'est pas effacé : il passe en `disparu`, parce qu'une disparition est elle-même une information.

La liste des pages surveillées n'est pas dans ce dépôt. Elle vit dans la configuration du serveur, pour ne pas publier un annuaire des collectifs à surveiller.

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
| `VEILLE` | `0` arrête la veille (utile en test) | active |
| `VEILLE_EVERY_MS` | intervalle de relecture d'une page | 20 min |
| `VEILLE_PREF_EVERY_MS` | intervalle de relecture d'un site de préfecture | 30 min |

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
| `GET /api/arretes?etat=&depuis=&limit=` | arrêtés en cours ; `etat` vaut `complet` ou `partiel` |
| `GET /api/legal?status=&depuis=&limit=` | candidats legal team (clé) ; `status` parmi `neuf`, `propose`, `ignore`, `disparu` |
| `POST /api/legal/{id}` | change l'état d'un candidat : `{ status }` (clé) |
| `GET /api/veille` | état de la veille et liste des sources (clé) |
| `POST /api/veille/sources` | ajoute une source : `{ url, dep?, label?, kind? }` avec `kind` parmi `pref`, `raa`, `page`, `legal` (clé) |
| `POST /api/veille/sources/prefectures` | ajoute les 101 préfectures (clé) |
| `POST /api/veille/sources/{id}/test` | relit une source tout de suite (clé) |
| `DELETE /api/veille/sources/{id}` | retire une source (clé) |
| `POST /api/veille/tour` | force un tour de veille (clé) |

Une source archivée deux fois le même jour n'est pas retéléchargée. Deux copies de contenu identique partagent le même fichier sur le disque.

## Déploiement

Le serveur tient dans un processus. Un service systemd, un reverse proxy devant, rien d'autre.

```ini
# /etc/systemd/system/nonobstant.service
[Unit]
Description=Nonobstant
After=network.target

[Service]
Type=simple
User=nonobstant
WorkingDirectory=/opt/nonobstant/app
Environment=PORT=8090
Environment=DATA_DIR=/opt/nonobstant/data
EnvironmentFile=/opt/nonobstant/env
ExecStart=/usr/bin/node server.js
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nonobstant/data

[Install]
WantedBy=multi-user.target
```

`API_KEY` va dans `/opt/nonobstant/env`, en lecture pour le seul utilisateur du service, jamais dans l'unité ni dans le dépôt.

Ce qu'il faut sauvegarder : `DATA_DIR` en entier. La base se reconstruit en partie, les copies du coffre non : ce sont elles qui ne se retrouvent nulle part ailleurs une fois la source disparue.

Le paquet `poppler-utils` rend les recueils PDF lisibles. Sans lui la veille tourne, mais elle ne voit que les titres.

## Vérifications

```sh
node --test test/*.test.js
npx eslint -c eslint.config.js --no-config-lookup server.js src test
```

## Licence

AGPL-3.0-or-later. Voir `LICENSE`.
