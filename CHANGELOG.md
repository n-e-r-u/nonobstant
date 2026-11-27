# Journal des versions

## 0.5.0

L'interface reprend un système de design existant : fond maillé, titres en Ortland, cartes blanches à contour 2px et ombre dure, pastilles jaunes. États vides qui disent ce qui apparaîtra là, retour visible pendant une recherche, contrastes mesurés et tous au-dessus du seuil AA, lien d'évitement, respect de la préférence pour moins d'animation.

## 0.4.0

Page de consultation publique : état du fonds, arrêtés en cours avec leurs mesures citées et leur source, recherche d'une adresse dans le coffre. Thème clair et sombre, sans dépendance ni suivi. Unité systemd et consignes de sauvegarde dans le README.

## 0.3.0

Veille des numéros de legal team : lecture des pages de collectifs, candidats avec leur contexte et leur source, copie au coffre, indice de rattachement, signalement des numéros disparus. Aucun numéro n'est publié sans validation humaine, et un numéro n'est retenu que si son entourage parle d'antirépression.

## 0.2.0

Veille des arrêtés préfectoraux : 101 sites surveillés, pages de recueil repérées seules, documents téléchargés une fois et versés au coffre, lecture des recueils PDF, et extraction structurée (département, commune, début, fin, mesures). Un arrêté dont la zone ou la période ne se lisent pas est marqué partiel plutôt que complété au jugé.

## 0.1.0

Premier socle : serveur HTTP sans dépendance, base SQLite, garde réseau contre les adresses internes, coffre des preuves (archivage d'une source avec son empreinte et sa date, extrait public, copie complète privée).
