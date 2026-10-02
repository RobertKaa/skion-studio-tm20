# TM Skin Studio — audit desktop et refonte

Date : 2 octobre 2026. Application : http://localhost:5173/.

## 1. Périmètre et méthode

Cet audit porte sur la création et l’édition d’une livrée sur ordinateur : dessin, calques, pièces UV, couleur, matière, vernis, saleté, éclairage et aperçu 3D. Le mobile est exclu à votre demande. Le problème connu de restitution des calques après export/réimport est également exclu des nouveaux tests.

La dernière série de tests a été réalisée **dans votre onglet déjà ouvert**, avec les commandes de l’interface : clics, vrais glissés sur la texture, saisie, raccourcis et observation du rendu. Aucun nouveau navigateur de test séparé n’a été lancé après votre demande. Les compilations servent à vérifier que les modifications sont intégrables ; elles ne remplacent pas les essais de l’interface.

Le rapport distingue :

- **Page ouverte** : manipulation et résultat observés dans cet onglet.
- **Vérification précédente** : résultats obtenus dans les séries antérieures de cette session, avant la consigne de rester dans l’onglet ouvert.
- **Lecture du code** : constat technique, sans prétendre avoir reproduit tous les cas dans l’interface.
- **À valider** : scénario non couvert ou comportement du jeu non vérifié.

Les calques nommés « Audit », « Logo capot » et « Logo épaule » sont des exemples de test. Les premières scènes ont été réinitialisées pendant le développement. Depuis la section 12, le dernier projet enregistré se rouvre automatiquement après rechargement ; les modifications postérieures à l’enregistrement nécessitent un nouvel enregistrement.

## 2. Synthèse

L’éditeur permet déjà de construire une livrée avec des éléments séparés et neuf canaux. La faiblesse principale était la confusion entre **fond de la texture**, **élément sélectionné**, **prochain tracé** et **simulation 3D**. Certaines commandes donnaient aussi l’impression d’agir sans modifier les données effectivement rendues.

La refonte rend ces quatre portées explicites. Les matières des groupes sont maintenant réellement appliquées à leurs formes. Les lumières ont un comportement par calque et des simulations indépendantes de nuit et de freinage. Les outils de ligne suivent désormais leurs réglages et le vidage d’une texture est annulable.

L’application dispose maintenant d’une bibliothèque de projets éditables. Pour devenir un outil de production complet, les prochaines priorités sont les retouches de tracés et de masques, et le retour visuel entre pièce UV et voiture.

## 3. Architecture de l’interface mise en place

| Zone | Rôle |
|---|---|
| Barre principale | Nom de livrée, vues, historique, génération, import et export |
| Rail gauche | Outils nommés, raccourcis visibles, symétrie, grille et guide UV |
| Navigation de texture | Famille Carrosserie / Détails / Roues, puis canal Couleur / Matière / etc. |
| Barre de contexte | Outil ou sélection active, indication du geste ; aucun doublon de curseurs de matière |
| Onglet Texture | Fond, réglages globaux, remplissage d’une pièce |
| Onglet Élément | Propriétés du dessin sélectionné, nom et géométrie |
| Onglet Outil | Réglages du prochain tracé lorsque l’outil de dessin est actif |
| Onglet Calques | Sélection, ordre, visibilité, verrouillage et suppression |
| Tests des lumières | Nuit, freinage et multiplicateur d’aperçu séparés des valeurs peintes |

Les contrôles utilisent une même palette sombre, des surfaces hiérarchisées et un accent bleu. Les contrôles de matière occupent la largeur de l’inspecteur. Le rail affiche le nom des outils sans dépendre du survol. Les presets Peinture / Mat / Métallisé / Chrome donnent un point de départ concret.

## 4. Problèmes corrigés

### 4.1 Matière du toit/capot sans effet

**Cause :** le remplissage UV est un groupe de polygones. Modifier le remplissage du groupe ne changeait pas les couleurs portées par ses enfants dans Fabric. La valeur de l’inspecteur pouvait être celle du groupe plutôt que celle de la peinture visible.

**Correction :** lecture des formes réellement peintes, application récursive aux enfants, invalidation des caches et prise en charge des lignes et traits par leur contour. Les images sont conservées comme données raster. Un groupe contenant différentes finitions est signalé.

**Résultat :** la sélection TOIT / CAPOT passe à Chrome avec rugosité 3 % et métal 100 %. Mat puis Annuler restitue Chrome. L’application globale conserve le calque et Annuler récupère sa finition locale. Ces parcours ont été rejoués dans la page ouverte. Les tests précédents avaient aussi confirmé les valeurs des pixels et le changement du rendu 3D.

### 4.2 Barre supérieure encombrée et réglages redondants

**Correction :** retrait des curseurs de propriétés de la barre supérieure ; réglages dans l’inspecteur contextuel. Texture reste accessible lorsqu’un élément est sélectionné. Les groupes affichent le nom de la pièce plutôt que le seul type « Groupe ».

**Résultat :** un emplacement de modification par portée. La barre conserve une indication de geste et un accès aux réglages de l’outil.

### 4.3 Réglage global qui pouvait supprimer les éléments

**Correction :** « Appliquer à tous les éléments » peint les formes éditables et le fond sans supprimer leurs géométries ni leurs calques. Une seule annulation restitue les valeurs précédentes. Les images et références gardent leurs propres données.

**Résultat :** vérifié avec un remplissage TOIT / CAPOT ; le nombre de calques reste identique et la finition locale revient après Annuler.

### 4.4 Visualisation technique rouge/vert difficile à lire

**Correction :** affichages Rugosité et Métal en niveaux de gris, plus Données pour la représentation encodée. La légende précise sombre = brillant / clair = mat. Le filtre d’affichage ne modifie pas les données de peinture.

### 4.5 Matière des détails et roues atténuée par le matériau 3D

**Cause :** les coefficients du matériau Three multipliaient la texture, empêchant les valeurs peintes d’avoir toute leur amplitude.

**Correction :** coefficients de base à 1 pour que la carte de matière fournisse les valeurs. Le réarrangement des canaux vers ceux attendus par Three est conservé.

**Limite :** le rendu est celui du studio Three, pas une preuve d’équivalence avec toutes les conditions d’éclairage du jeu.

### 4.6 Néons, phares et freinage confondus

| Défaut | Correction |
|---|---|
| Un rôle unique pour toutes les lumières | Comportement propre à chaque calque, groupe, trait ou image lumineuse |
| « Phares (nuit) » sans simulation jour/nuit | Ambiance de nuit, studio assombri et activation des seules zones concernées |
| Freinage qui boostait toutes les émissions, compteur compris | Activation des zones de frein sans multiplicateur général supplémentaire |
| Rôle et luminosité mélangés dans la génération | Couleur opaque du générateur ; comportement conservé séparément |
| Code de frein 3 utilisé comme opacité de 3/255 | Les feux générés conservent leur luminosité peinte |
| Couleur du compteur hors historique | Couleur intégrée à l’historique et restaurée lors d’une annulation |
| Réglages de test trop bas dans l’inspecteur | Section de simulation visible avant les propriétés lumineuses |

**Parcours actuel :** sélectionner un comportement du prochain tracé, remplir PHARE ou FEU ARRIÈRE, puis modifier couleur et comportement dans Élément. Texture propose le comportement du fond et une application explicite à tous les calques, hors compteur.

**Résultat dans la page ouverte :** création de deux calques, phares cyan et frein rouge. Le phare s’active en ambiance de nuit ; le frein ajoute des zones lumineuses lors du freinage. Les comportements individuels, l’application globale et leurs annulations ont été vérifiés. Un rectangle dessiné hérite aussi du comportement choisi pour le prochain tracé. La couleur du compteur revient au blanc après annulation.

**Données :** une carte de comportements suit les objets visibles et leur ordre. La couleur et l’opacité continuent de régler la lumière peinte. Le branchement d’export transmet aussi cette carte aux codes alpha existants. Sa restitution en jeu et son réimport ne sont pas inclus dans cette validation.

### 4.7 Ligne différente des réglages affichés

**Cause :** l’outil utilisait la couleur de remplissage et imposait au moins 6 px, malgré les réglages de couleur de ligne et d’épaisseur. L’épaisseur n’était pas disponible après sélection.

**Correction :** couleur dédiée au trait, épaisseur choisie dès 1 px, curseur d’épaisseur disponible sur la ligne sélectionnée.

**Résultat :** vrai glissé dans la page ouverte avec couleur #FF2277 et épaisseur 2 px ; la sélection restitue ces valeurs. Une retouche d’épaisseur et son annulation fonctionnent.

### 4.8 Couleurs difficiles à saisir précisément

**Correction :** champs de code couleur pour fond, sélection, outils et compteur, avec validation du format et restitution de la valeur courante si une saisie incomplète est quittée. Le sélecteur de couleur reste disponible. Les couleurs RGBA sont affichées avec leurs valeurs RGB.

**Résultat :** saisies de couleur de ligne, de frein rouge et du compteur testées dans la page ouverte.

### 4.9 Vidage irréversible dans l’historique et confirmation native bloquante

**Cause :** le vidage réalignait la baseline, supprimant la possibilité de revenir à la texture précédente. La boîte native a aussi bloqué les commandes du navigateur durant le test.

**Correction :** retrait des éléments sous suspension d’historique, puis enregistrement d’une seule opération annulable. Confirmation intégrée à l’application, focus initial sur Annuler, navigation entre les actions au clavier et fermeture avec Échap.

**Résultat dans la page ouverte :** Échap ferme la confirmation ; Vider retire le calque ; Annuler restitue le remplissage UV. La fermeture de l’ancienne boîte native par l’utilisateur a été nécessaire avant de reprendre les tests.

### 4.10 Autres corrections de la session

- Palettes distinctes par type de canal : un réglage de matière ne remplace plus la couleur de dessin.
- Peinture 3D : conservation du type de canal en passant sur une autre famille ; refus d’un canal absent au lieu d’écrire dans Couleur.
- Références : visibles dans l’éditeur, exclues des textures peintes et du rendu 3D ; remplacement du guide et opacité annulable.
- Images : erreurs affichées, limite de fichier à 32 Mio, dimensions à 8192 px par côté et surface à 32 millions de pixels ; destination capturée avant le chargement asynchrone.
- Calques : sélection par bouton accessible et double-clic pour ouvrir les propriétés.
- Générateur : « Revenir à ma livrée » et « Garder cette livrée » rendent les actions compréhensibles.
- Sortie du canal de lumière : retour à l’éclairage de jour pour juger correctement les matières.
- Copie entre canaux : aide précisant que les valeurs sont copiées sans conversion de leur sens.

## 5. Matrice de vérification

| Fonction | Couverture et résultat |
|---|---|
| Rectangle, ellipse, polygone | Page ouverte : vrais glissés, calques distincts |
| Ligne | Page ouverte : couleur dédiée, 2 px, édition et annulation |
| Pinceau | Page ouverte : trait libre séparé ; réglages de lissage accessibles |
| Texte | Page ouverte : création, saisie AUDIT, sortie de saisie, duplication |
| Position numérique | Page ouverte : déplacement X du phare, annulation indépendante |
| Visibilité et verrouillage | Page ouverte : Masquer/Afficher et Verrouiller/Déverrouiller |
| Ordre et suppression de calques | Page ouverte : descente, suppression, restauration ; tests précédents complémentaires |
| TOIT / CAPOT | Page ouverte : couleur et matière, presets et annulations |
| Matière globale | Page ouverte : conservation des calques et retour à la matière locale |
| Fond Vernis | Page ouverte : passage de 0 à 100 %, puis annulation à 0 |
| Fond Saleté | Page ouverte : passage à 0, puis annulation à 100 % |
| Familles et neuf canaux | Accessibilité vérifiée dans la page ; parcours complet dans la série précédente |
| Phare / frein / néon | Page ouverte : rôles indépendants, nuit, freinage, annulation, application globale |
| Couleur du compteur | Page ouverte : modification puis annulation au blanc |
| Vidage | Page ouverte : confirmation intégrée, Échap, vidage et récupération |
| 2D, 2D + 3D, 3D | Page ouverte et série précédente ; rotation/recadrage et peinture 3D testés précédemment |
| Grille, guide, symétrie | Série précédente : activation et états ; tous les cas d’édition de partenaires ne sont pas couverts |
| Images et références | Ajout et déplacement d’images sur la voiture testés dans la page ouverte ; détails de la nouvelle campagne en section 9. Les références de décalquage restent exclues du rendu 3D |
| Générateur | Série précédente : génération complète et restauration des neuf cartes en quittant |
| Copie entre canaux | Code inspecté ; absence de conversion signalée. Pas de nouvelle campagne exhaustive |
| Différentes largeurs desktop | Série précédente : 1280, 1440 et 1920 px sans débordement horizontal ; page ouverte à 1458 × 956 |
| Jeu Trackmania | À valider : éclairage, rôles alpha, matériaux et UV en conditions de jeu |
| Gros projets / longues sessions | À valider : charge, mémoire, centaines de calques, rapidité du pinceau |
| Export/réimport des calques | Hors périmètre demandé |

### Vérifications techniques

- Dernière compilation `npm run build` : réussie.
- Bundle principal : environ 1,507 Mo minifié / 428 ko gzip. Avertissement de taille émis par Vite.
- Régressions permanentes ajoutées précédemment et exécutées : encodage matière (9 contrôles), peinture de groupes/traits/images/opacité (5 ensembles), routage du canal de peinture (8 assertions).
- `scripts/test-illumination.ts` exécuté lors de la campagne images 3D : rôles, simulations indépendantes et encodage validés. Les cinq scripts unitaires complètent les essais fonctionnels réalisés dans la page ouverte ; ils n’ouvrent pas de navigateur.
- `scripts/test-image-placement.ts` : 13 assertions sur le repère UV, les pièces, la marge aux bords et les sauts de coordonnées. Réussi.
- Nouvelle analyse des dépendances de production : aucune vulnérabilité signalée par `npm audit --omit=dev`. Aucun changement de dépendances dans cette refonte.
- Aucune erreur JavaScript constatée dans les parcours de lumières inspectés. Cela ne constitue pas une couverture exhaustive.

## 6. Travaux encore nécessaires, par priorité

### P1 — Récupérer le travail après fermeture ou rechargement — réalisé en section 12

La bibliothèque IndexedDB conserve les projets enregistrés par **Enregistrer / Ctrl+S** ou lors de l’export pour le jeu. Le dernier projet enregistré se rouvre au démarrage. Le badge distingue le contenu courant du contenu enregistré, y compris après une annulation. Une récupération automatique des modifications non enregistrées reste une évolution possible.

**Critère d’acceptation :** rouvrir l’application avec les mêmes éléments, images, noms, ordre, verrouillages, matières, comportements lumineux et réglages de pièce.

### P1 — Permettre les retouches de dessin

Les outils permettent de créer, déplacer et styliser des décorations. Ils restent insuffisants pour de la retouche avancée : pas de gomme locale de masque, édition des points d’un trait, courbe Bézier, découpe booléenne ou recadrage d’image dans l’interface. Une gomme destructive de pixels ferait perdre la possibilité d’éditer les traits séparément ; privilégier des masques d’effacement éditables.

**Ordre recommandé :** masque d’effacement, panneau de points/courbes, regroupement/dégroupement explicite, alignement/distribution, gestion de remplissages et contours complexes.

### P1 — Rendre le lien pièce / voiture évident

Certaines zones Détails sont composées de nombreux îlots répartis sur la texture. Leur grande boîte englobante est normale, mais elle ressemble à une sélection de toute la voiture. Les noms PHARE ou FEU ARRIÈRE ne suffisent pas à expliquer tous les fragments visibles dans l’aperçu.

Ajouter un surlignage synchronisé entre UV et voiture, la sélection d’une pièce par clic sur le mesh, et une recherche de pièce. Vérifier le sens physique des groupes de détails sur les géométries officielles avant de promettre une correspondance parfaite avec les lampes du jeu.

### P2 — Donner un sens à la copie entre canaux

La géométrie et les valeurs de couleur sont actuellement clonées telles quelles. Une couleur vive copiée dans Matière devient des nombres de rugosité/métal, et non une finition choisie. L’avertissement ajouté limite la surprise mais ne résout pas le parcours.

Proposer « Reprendre les formes avec une finition… » pour Matière et « Reprendre les formes comme masque… » pour Vernis/Saleté. Conserver une copie des valeurs brutes en option avancée.

### P2 — Améliorer la lecture des masques et des rasters

- Le masque de saleté s’édite, mais l’aperçu n’affiche pas une couche de saleté simulée. Ne pas prendre l’absence de changement sur la voiture pour une preuve d’échec du masque.
- Une image raster de matière conserve ses propres pixels ; les curseurs sémantiques ne recolorent pas chaque pixel. Le panneau propose une forme de remplacement sur la pièce, mais une conversion/masque raster reste à concevoir.
- Le vernis est prévisualisé comme du clearcoat, sans reproduction complète des effets de peinture du jeu.

### P2 — Réduire les traitements pendant le dessin

Les événements de texture rafraîchissent plusieurs cartes. Les cartes de matière sont réarrangées en pixels ; la nouvelle carte de comportement lumineux rend les objets visibles individuellement. Cela fournit un résultat cohérent, mais doit être profilé avec beaucoup de calques.

Optimiser par carte réellement modifiée, cache de masque par objet et recalcul différé en fin de geste. Séparer le chargement du générateur et de la 3D pour réduire le bundle initial.

### P2 — Accessibilité et clavier

Les libellés, champs et onglets ont été améliorés. Il reste à vérifier toute la navigation clavier, les états de focus, l’annonce des valeurs mixtes et les interactions des zones canvas avec un lecteur d’écran. Les géométries restent principalement visuelles.

### P2 — Sécurité et limites de ressources

Les limites d’images protègent certains cas volumineux. La limite de dimensions intervient après décodage ; elle ne garantit donc pas une faible consommation mémoire lors du décodage. Les archives sont traitées localement, mais une limite de volume décompressé et de nombre d’entrées doit encore être auditée. Ce rapport ne prétend pas à un audit de sécurité complet des chargeurs DDS/ZIP/mesh.

## 7. Parcours conseillé dans la nouvelle interface

1. Choisir la famille et le canal.
2. Dans Texture, choisir la pièce et son apparence ; Appliquer crée un calque éditable.
3. Ajouter formes, traits, texte ou images avec les outils nommés.
4. Utiliser Élément pour retoucher un dessin existant et Calques pour l’organiser.
5. Pour Matière, commencer par un preset, puis affiner rugosité et métal ; pour un masque, utiliser sa quantité en niveaux de gris.
6. Pour les lumières, attribuer le comportement par calque, puis vérifier les états de nuit et de freinage dans l’aperçu.
7. Contrôler la voiture en 3D et les UV en 2D ; la validation dans le jeu reste nécessaire.

## 8. Captures conservées

- [Lumières finales, phares cyan et frein rouge](audit-evidence/live-lights-final.jpg)
- [Jour](audit-evidence/live-lights-day.jpg), [nuit](audit-evidence/live-lights-night.jpg), [nuit + freinage](audit-evidence/live-lights-night-brake.jpg)
- [Calques de dessin et texte](audit-evidence/live-drawing-layers.jpg)
- [Matière locale du toit/capot](audit-evidence/live-roof-material.jpg)
- [Confirmation de vidage intégrée](audit-evidence/live-clear-dialog.jpg)
- Séries antérieures : `desktop-1280.png`, `desktop-1440.png`, `desktop-element-1440.png`, `toit-mat.png`, `toit-chrome.png`.

Ce document remplace les recommandations desktop de l’audit historique `AUDIT-UX.md`. Il conserve les limites et le travail restant au lieu de présenter la refonte comme une validation complète en jeu.

## 9. Édition des images en 3D et nouvelle présentation

### 9.1 Parcours livré

L’application s’ouvre dans **Atelier 3D**. Le bouton **Ajouter un logo** ouvre le choix de fichier. Une fois l’image choisie, une bannière demande de cliquer sur une surface de la voiture. L’image devient un calque de couleur dans la famille réellement touchée : carrosserie, détails ou roues. Elle apparaît aussi dans la texture 2D.

Le mode **Images** permet de sélectionner puis glisser une image directement sur la voiture. **Explorer** libère le clic gauche pour tourner la caméra ; **Peindre** active le pinceau 3D. Pendant une édition, le clic droit tourne la voiture et le bouton central déplace la vue.

Dans **Élément**, les commandes propres aux images permettent de :

- réduire ou agrandir proportionnellement ;
- saisir largeur, hauteur et rotation avec des champs nommés ;
- conserver les proportions pendant une saisie numérique ;
- tourner par pas de 15° ;
- changer d’emplacement avec **Replacer sur la voiture**, en conservant taille et rotation ;
- modifier nom et opacité, dupliquer, retourner ou supprimer le calque.

La famille d’une image existante est conservée lors du repositionnement. Un clic sur les pneus d’une image de carrosserie affiche une explication et laisse le choix d’emplacement actif. Pour une nouvelle image, la famille est choisie automatiquement et le canal Couleur est utilisé, même si Matière était affiché auparavant.

### 9.2 Problèmes trouvés et corrigés pendant les essais

| Problème reproduit | Correction |
|---|---|
| Les images ne pouvaient être posées ou déplacées sur le mesh | Intersections 3D converties en coordonnées de texture ; sélection et déplacement du véritable calque Fabric |
| Confusion entre rotation de caméra et déplacement d’image | Trois modes nommés avec état actif et aide contextuelle |
| Échap annulait le placement puis désélectionnait aussi le logo précédent | Annulation traitée avant les autres raccourcis ; la sélection existante est conservée |
| Un logo pouvait disparaître en sortant du masque de sa pièce | Contrôle du pointeur, du centre et de sa marge au bord ; refus des changements de pièce et des sauts UV pendant un glisser |
| Un clic sur un pixel transparent ou une zone rognée pouvait sélectionner une image invisible | Vérification de l’alpha effectivement rendu, avec le masque de l’image |
| Les outils de formes semblaient inactifs en 3D plein cadre | Choisir Rectangle, Ellipse, Ligne, Polygone, Texte ou Pipette ouvre automatiquement la vue côte à côte |
| Taille et rotation d’image difficiles à découvrir | Carte d’actions spécifique, proportions et champs numériques accessibles |

Un déplacement terminé crée une seule entrée d’historique. Les interruptions par relâchement, sortie du panneau, perte de capture ou perte de focus terminent le geste. Un placement en cours refuse les clics répétés pour éviter les doublons.

### 9.3 Vérifications dans l’onglet ouvert

Le fichier `audit-evidence/logo-3d-test.svg` a été choisi avec le vrai contrôle d’import d’image. Aucun scénario UI de cette campagne n’a utilisé un navigateur séparé.

| Scénario | Observation |
|---|---|
| Ajouter un logo au capot | Nouveau calque sélectionné, logo visible sur la voiture |
| Glisser le logo du capot | Centre passé de X=586, Y=661 à X=583, Y=572 |
| Annuler puis rétablir un déplacement | Un seul Annuler restitue la pose précédente ; Rétablir retrouve la pose déplacée |
| Ajouter une deuxième image | Deux calques distincts ; aucun aplatissement lors de l’ajout |
| Déplacer l’image d’épaule | X=754, Y=307 devient X=771, Y=310 ; le capot reste à X=583, Y=572 |
| Glisser l’épaule vers une autre zone | Message de bord atteint ; l’image reste visible et sa pose est conservée |
| Largeur avec proportions | Largeur 220 px, hauteur 110 px pour le logo au ratio 2:1 |
| Rotation rapide | Rotation 180° → 195°, changement visible sur la voiture |
| Replacer sur une jante | Centre modifié à X=721, Y=138 ; largeur 220 px et rotation 195° conservées ; Annuler restitue le capot |
| Cliquer un pneu pour replacer une image de carrosserie | Message de famille incompatible ; aucune migration silencieuse |
| Annuler un nouvel ajout avec Échap | Aucun troisième calque ; le logo déjà sélectionné le reste |
| Verrouiller l’image d’épaule, puis glisser en 3D | Pose X=771, Y=310 conservée ; déverrouillage effectué via Calques |
| Passer en vue côte à côte | Les mêmes images, rotations et positions sont visibles dans l’atlas 2D et sur le mesh |
| Choisir Rectangle depuis Atelier 3D | La texture s’ouvre ; un vrai glisser crée un troisième calque ; Annuler retrouve les deux images |
| Pinceau 3D après ajout des images | Un glisser crée un troisième calque ; une annulation retrouve les deux images |
| Mode Explorer et recadrage | Le glisser gauche tourne la voiture ; Recadrer restitue la vue de départ sans changer les positions des images |
| Bureau 1280 × 800 | En-tête et actions visibles ; largeur du document et largeur visible toutes deux à 1280 px, sans débordement horizontal ; taille initiale rétablie ensuite |
| Matière locale et globale après refonte | Fond Mat : rugosité 235/255, métal 0 ; capot Chrome : rugosité 8/255, métal 255 ; modifier le capot ne change pas le fond |
| Lumières après refonte | Groupe cyan configuré Phares (nuit), puis groupe rouge configuré Feux de frein ; cyan visible la nuit, rouge présent au freinage et absent sans freinage |

Le rôle lumineux a été vérifié par sélection de l’élément et observation des deux états de freinage, pas seulement par l’apparence du curseur. Les zones de détail ne correspondent pas toutes à une lampe physique unique : dans cet essai, « FEU ARRIÈRE » allume également une bande de carénage. Le repérage et les libellés de ces zones restent à revoir.

### 9.4 Refonte graphique et fonctionnelle

- Thème sombre plus neutre, accent menthe, texte secondaire plus lisible, cartes et zones de travail arrondies.
- Navigation séparée en **Surface** et **Peinture**, avec état sélectionné explicite.
- Vues nommées **Texture 2D**, **Côte à côte** et **Atelier 3D**.
- Ajout de logo placé en tête du rail ; outils d’édition séparés des outils qui dessinent sur la texture.
- Panneau latéral indiquant en permanence la famille, le canal et la portée : Fond & pièces, Sélection, Prochain tracé ou Calques.
- Écran de départ proposant image, couleurs/matières et accès aux calques.
- Bouton **Modifier la sélection** dans Calques, pour ne plus dépendre de la découverte du double-clic.
- Les réglages du groupe ou de l’image sont concentrés dans Élément ; la barre supérieure donne le contexte et les instructions.

### 9.5 Limites et suite de la refonte

**État de la première itération.** La section 10 décrit l'ajout ultérieur du mode Projection 3D et de ses poignées. Le mode UV décrit ci-dessous reste disponible pour le placement limité à une pièce.

Cette fonction édite les images dans les UV existants. Il ne s’agit pas d’une projection de décalque volumétrique indépendante de l’atlas. Les surfaces partageant les mêmes UV peuvent afficher le même logo : cela a été observé sur les jantes. Les logos sont rognés au contour de la pièce choisie quand un guide est disponible. Les coutures et les marges sont volontairement bloquées pendant le glisser ; Replacer permet de choisir une autre pièce.

La rotation et la taille s’éditent dans le panneau, sans poignées de transformation directement sur le mesh. Les points suivants restent utiles : surlignage du logo sur la voiture, gizmos de rotation/taille, recadrage d’image, masque retouchable, transfert explicite entre familles et repérage visuel des zones de lumière. Les guides disponibles sont ceux du modèle de référence ; la correspondance de leurs pièces sur des meshes personnalisés reste à valider.

La sauvegarde du travail reste la priorité P1 de la section 6. Le placement 3D ne résout pas le problème connu de restitution des calques après export/réimport, exclu de cette campagne. Les performances avec plusieurs centaines d’images et les résultats dans Trackmania ne sont pas validés par ces essais.

### 9.6 Preuves et contrôles techniques

- [Résultat final dans la page ouverte](audit-evidence/live-images-3d-final.jpg)
- [Nouvelle interface à 1280 px](audit-evidence/live-redesign-1280.jpg)
- [Images dans les deux vues](audit-evidence/live-images-3d-split.jpg)
- [Matière locale avec la nouvelle interface](audit-evidence/live-redesign-local-material.jpg)
- [Phares de nuit](audit-evidence/live-redesign-lights-night.jpg)
- [Freinage actif](audit-evidence/live-redesign-lights-brake.jpg), [freinage désactivé](audit-evidence/live-redesign-lights-no-brake.jpg)
- `npm run build` : réussi ; avertissement de taille du bundle maintenu.
- `npm run lint` : aucune erreur ; avertissements existants dans les scripts UV et dépendances de l’effet d’initialisation React.
- Cinq scripts unitaires validés : matière, peinture des objets, choix du canal 3D, illumination et placement d’image.
- `npm audit --omit=dev` : 0 vulnérabilité signalée. Les limites d’import d’image existantes sont conservées ; aucun nouveau paquet ajouté.
- Aucune erreur console collectée dans la page lors du passage final. Deux images de démonstration sont laissées dans Atelier 3D.

## 10. Projection 3D et matière liée à l’image — 2 octobre 2026

### 10.1 Parcours disponible

Dans Atelier 3D, **Ajouter un logo** ouvre le fichier puis prépare son placement. Le mode par défaut est **Projection 3D · plusieurs pièces**. Le clic sur la voiture définit le centre, l’orientation de la surface et la direction de lecture. Le moteur projette les pixels dans les atlas existants de carrosserie, détails et éventuellement roues ; les coutures UV ne constituent plus une limite au déplacement.

- Un seul calque maître contient l’image originale et les paramètres du projecteur. Les fragments des autres surfaces sont liés à ce maître.
- Le glisser translate le projecteur en conservant son orientation. **Replacer sur la voiture** l’aligne sur la normale d’une nouvelle surface. Ce choix évite les changements brusques d’orientation à chaque triangle du mesh.
- Quatre poignées règlent la taille proportionnelle, une poignée ronde la rotation. Elles suivent la caméra, fonctionnent à la souris et acceptent les flèches du clavier.
- L’inspecteur conserve les réglages de taille et rotation. **Surfaces et profondeur** permet de choisir carrosserie, détails et roues, puis la profondeur de projection.
- Le verre, les faces arrière, les surfaces presque perpendiculaires et les surfaces masquées derrière une autre surface sont écartés. Le contrôle d’occultation utilise un tampon de profondeur du projecteur.
- Le mode **Texture UV · une pièce** reste disponible. Dans Texture 2D, un ajout reste un objet UV classique.

Les fragments projetés sont réellement présents dans les textures utilisées par l’aperçu et l’export ; le cadre et les poignées constituent seulement une aide visuelle. Le fonctionnement dans Trackmania n’a pas été vérifié dans cette campagne.

### 10.2 Switch « Matière propre à l’image »

Le switch est disponible avant le placement et dans **Élément → Matière du logo** après l’ajout. Il fonctionne aussi pour les images UV ordinaires sur les cartes Couleur.

Activé, il ajoute un calque **Matière · nom de l’image** dans chaque carte de matière touchée. Ses pixels encodent la rugosité en rouge et le métal en vert. L’alpha reprend exactement la silhouette de l’image : les trous et les marges transparentes n’imposent aucune finition au fond.

Le panneau permet de régler rugosité et métal séparément, ou de choisir Peinture, Mat, Métallisé et Chrome. Le masque suit taille, rotation, position, opacité, visibilité et verrouillage. Les réglages restent locaux à l’image ; modifier le fond global ou un deuxième logo ne remplace pas les valeurs du premier.

Désactiver le switch retire les couches liées sans supprimer l’image. Les valeurs choisies sont mémorisées pour une réactivation. Cliquer le calque de matière ouvre directement les réglages de l’image maîtresse. Supprimer ce calque de matière désactive la finition propre ; supprimer l’image retire ses fragments et ses masques. L’ordre des masques suit l’ordre des images.

La réinitialisation d’une carte conserve les fragments liés à une image d’une autre carte et réinitialise son fond et ses calques indépendants. La confirmation explique cette portée. Pour retirer une finition liée, utiliser le switch ou supprimer son calque Matière.

### 10.3 Vérifications réalisées dans la page déjà ouverte

Les interactions ont été effectuées dans l’onglet existant `http://localhost:5173/`, avec un SVG transparent de test. Aucun second navigateur ou test fonctionnel sans interface n’a été utilisé.

| Vérification | Résultat observé |
|---|---|
| Projection avec matière activée avant le clic | Image dans Carrosserie/Couleur et fragments dans Détails/Couleur ; couches liées dans les deux cartes Matière |
| Poignée de taille | Taille 105 % → 235 %, aspect conservé ; une seule annulation retrouve 105 % et Rétablir retrouve 235 % |
| Poignée de rotation | Glisser : rotation 0° → −32° ; image et matière tournent ensemble |
| Rotation au clavier | Flèche droite : −32° → −27° ; Annuler restitue −32° |
| Glisser sur l’image | Projection déplacée sur le capot, finition et fragments déplacés ; la seconde image reste indépendante |
| Replacer sur une nouvelle surface | Nouveau placement sur le capot ; taille 235 %, rotation −32°, rugosité 8/255 et métal 255/255 conservés ; Annuler restitue la pose précédente |
| Dupliquer une projection | Troisième image indépendante avec sa matière Chrome et les mêmes dimensions ; Annuler retrouve les deux images initiales |
| Traverser une surface exclue | Arrêt sur la roue et message expliquant comment activer cette surface |
| Choisir les surfaces | Désactiver Détails retire les fragments sur les pièces de détail ; réactivation les restitue |
| Profondeur au clavier | Curseur 0,46 → 0,48 ; valeur et rendu sont éditables ; annulation effectuée |
| Chrome propre à l’image | Rugosité 8/255, métal 255/255 ; reflets visibles sur la silhouette du logo |
| Switch désactivé puis réactivé | Finition héritée du fond puis retour aux valeurs Chrome ; couleur et pose conservées |
| Suppression du calque Matière | Image conservée et switch désactivé ; Annuler rétablit les couches |
| Matière globale et deuxième image | Fond Mat 235/255 et 0/255 ; première image Chrome 8/255 et 255/255 ; deuxième image Mat 235/255 et 0/255 |
| Image UV avec matière | Largeur 220 px, hauteur 110 px, centre X=610/Y=400, rotation 25° ; masque Métallisé 72/255 et 150/255 dans Matière, avec les trous transparents du SVG |
| Suppression de cette image UV | Image et masque retirés ; les deux projections précédentes restent présentes |
| Ordre des calques | Monter l’image Chrome fait monter son masque ; Annuler restitue l’ordre précédent |
| Verrouillage | Glisser sur la projection mate verrouillée ne la déplace pas ; déverrouillage effectué ensuite |
| Réinitialisation de Matière | Fond 235 → 90 puis Annuler 90 → 235 ; les deux couches liées restent présentes |
| Mises à jour du code dans la page | Les deux projections, leurs matières et l’historique sont conservés lors des mises à jour à chaud |

Un défaut trouvé pendant ces essais a été corrigé : le glisser réorientait le projecteur avec chaque nouvelle normale de triangle, ce qui pouvait faire disparaître le logo. Le déplacement conserve maintenant l’orientation ; Replacer est l’action explicite pour changer de surface et d’orientation.

### 10.4 Contrôles techniques et limites

- `npm run build` : réussi ; bundle JavaScript de 1 532,88 ko (435,20 ko compressés). L’avertissement de taille reste présent.
- `npm run lint` : aucune erreur, neuf avertissements existants dans les scripts UV et l’effet d’initialisation React.
- Les six scripts unitaires passent : matière, peinture des objets, choix du canal, illumination, placement UV et projection 3D.
- `npm audit --omit=dev` : zéro vulnérabilité signalée. `git diff --check` : aucun défaut d’espacement.
- Aucune erreur console collectée lors du contrôle final dans la page. Deux projections sont laissées dans Atelier 3D : une Chrome et une mate, avec des finitions indépendantes.
- Un nouveau script unitaire couvre projection sur deux îlots UV disjoints, plusieurs familles, exclusion de famille, faces arrière, profondeur, occultation, transparence, alpha du masque R/G, déplacement, dimensions invalides, allocations bornées et absence de halo noir aux bords transparents.
- Les cinq scripts unitaires précédents sont conservés : matière, peinture des objets, choix du canal, illumination et placement UV.
- Les sources sont normalisées à 2048 px maximum pour la projection, avec les limites d’import existantes de 32 Mo, 8192 px par côté et 32 millions de pixels. Les sources de projection utilisent des URLs de fichiers locales à la session ; aucun paquet n’a été ajouté.
- L’historique conserve le maître, reconstruit les fragments et les masques, et fusionne les changements d’un geste. Les images sont aussi conservées pendant les mises à jour à chaud du serveur de développement. **Cette protection ne remplace pas une sauvegarde de projet ni une récupération après fermeture/rechargement.** La priorité P1 reste ouverte.
- La projection est plane : elle peut se découper sur des surfaces adjacentes, mais ne s’enroule pas autour de toute la voiture. Les angles importants peuvent étirer ou interrompre l’image. Ajuster la profondeur, l’orientation et les surfaces visées.
- Une texture commune ne peut pas distinguer deux surfaces physiques qui partagent exactement les mêmes UV. Cette limite du modèle reste présente, notamment pour certaines roues.
- La sélection des surfaces est actuellement faite par famille (carrosserie/détails/roues), sans liste de pièces physiques individuelles. Le découpage fin retouchable et le miroir de projecteur restent des extensions possibles.
- Les performances avec des centaines de projecteurs et les meshes personnalisés complexes ne sont pas validées. L’aperçu utilise les textures de travail à 1024 px.
- Le problème connu de restitution des calques à l’export/réimport n’a pas été retesté.

### 10.5 Preuves visuelles

- [Matière propre désactivée](audit-evidence/live-projection-material-off.jpg)
- [Masque de matière dans l’atlas et résultat 3D](audit-evidence/live-projection-material-atlas.jpg)
- [Matière liée d’une image UV après transformations](audit-evidence/live-uv-image-material.jpg)
- [Projection et finition dans l’interface finale](audit-evidence/live-projection-final.jpg)

## 11. Continuité du logo sur les pentes — 2 octobre 2026

### 11.1 Problème signalé et diagnostic

Le logo Chrome apparaissait coupé sur le relief de la carrosserie. Le défaut a été repris dans la page existante, avec le projet et les deux images présents. Augmenter la profondeur de 0,82 au maximum de 1,50 ne comblait pas la coupure : une profondeur insuffisante n’expliquait pas cette zone manquante.

Deux mécanismes ont été améliorés :

- La direction du projecteur était déduite de la normale du triangle cliqué. Une pente voisine pouvait donc être presque de profil, tournée à l’opposé du projecteur ou occultée dans cette direction, même si elle était visible depuis la caméra.
- Le calcul d’occultation comparait la profondeur du pixel UV à celle d’un point voisin dans un tampon raster de 512 px, avec une tolérance fixe. Sur une pente forte, ce décalage pouvait faire passer une surface pour son propre obstacle.

### 11.2 Changements disponibles

- Les nouveaux logos et l’action **Replacer sur la voiture** utilisent maintenant la direction de la vue au moment du clic. Cela permet de couvrir les reliefs visibles sans dépendre de la normale d’un seul triangle.
- **Élément → Projection 3D → Aligner avec cette vue** réoriente un logo existant, à son centre actuel, depuis l’angle de vue choisi. Taille, angle de rotation et matière sont conservés. Une seule annulation restitue la projection précédente.
- Les faces inclinées vers le projecteur restent éligibles, même avec une pente forte. Les faces arrière et celles exactement de profil restent exclues.
- L’occultation est évaluée au point exact par interpolation dans les triangles. Une grille sert uniquement à retrouver les triangles candidats ; sa résolution ne détermine plus la profondeur comparée.
- L’aide contextuelle distingue Explorer du déplacement d’image. La vue de travail est également conservée pendant les mises à jour à chaud en développement.

L’orientation reste fixée sur la voiture après l’alignement : tourner la caméra ne déplace pas la peinture. Pour choisir une autre direction de projection, tourner la voiture puis utiliser à nouveau **Aligner avec cette vue**.

### 11.3 Vérifications dans la page ouverte

| Essai | Résultat |
|---|---|
| Profondeur au maximum | La grande coupure subsiste ; valeur d’essai annulée |
| Aligner le logo existant depuis la vue de la zone signalée | T et M continus sur le relief visible ; taille 160 %, angle 192°, rugosité 8/255 et métal 255/255 conservés |
| Annuler puis rétablir cet alignement | Une annulation retrouve la pose coupée ; Rétablir retrouve le logo continu, sans ajout de calque |
| Nouveau logo sur une pente, matière activée avant le clic | Troisième projection complète depuis la vue ; finition mate 235/255 et 0/255, indépendante du logo Chrome |
| Déplacement puis taille de ce nouveau logo | Glisser effectué, taille 100 % → 105 % ; les trois annulations retirent successivement taille, déplacement et ajout |
| Replacer le logo Chrome sur une pente voisine | Logo complet au nouveau point, mêmes taille/rotation/matière ; Annuler restitue le placement amélioré initial |
| Mise à jour à chaud finale | Vue, projet, deux images et matière du logo conservés |
| Console finale | Aucune erreur collectée |

Les deux images initiales sont laissées dans la page ; le logo Chrome est aligné pour combler la zone signalée. Le troisième logo de test a été retiré par l’historique.

### 11.4 Contrôles et portée

- Le test unitaire de projection couvre désormais une pente très forte, deux triangles inclinés voisins sans trou au raccord, et une surface réellement masquée à seulement 2 mm d’écart. Les six suites unitaires passent.
- Compilation réussie ; JavaScript 1 535,05 ko, soit 435,82 ko compressés. L’avertissement de taille du bundle reste présent.
- Lint : aucune erreur, neuf avertissements préexistants. Audit des dépendances de production : zéro vulnérabilité signalée. Aucun paquet ajouté.
- La projection reste une projection depuis une direction choisie. Elle ne déroule pas automatiquement une image autour de toute la voiture ; les faces arrière, les obstacles réels et le verre peuvent interrompre le résultat. Choisir une vue qui expose les surfaces souhaitées, puis ajuster la profondeur si nécessaire.
- Les performances sur des centaines de projecteurs et la restitution des calques par export/réimport n’ont pas été testées dans cette correction.

### 11.5 Comparaison visuelle

- [Avant l’alignement, depuis la même vue](audit-evidence/live-projection-relief-before.jpg)
- [Après l’alignement, matière conservée](audit-evidence/live-projection-relief-after.jpg)

## 12. Sauvegardes locales et projets éditables

### 12.1 Choix et parcours

**Enregistrer / Ctrl+S** conserve le projet complet dans IndexedDB, sur cet ordinateur et dans ce navigateur. Les images seraient trop volumineuses pour des cookies ou un simple localStorage. localStorage conserve seulement l’identifiant du dernier projet à rouvrir.

Le bouton **Mes projets** ouvre une bibliothèque avec miniatures, nom, date, nombre de calques et taille. Elle permet d’ouvrir, rechercher, renommer, enregistrer une copie, télécharger une sauvegarde, importer un projet et mettre un projet à la corbeille. La corbeille propose une restauration et une confirmation distincte avant suppression définitive.

L’export ZIP pour Trackmania enregistre aussi le projet local avant de préparer les textures. Si cet enregistrement échoue, le message de résultat le signale explicitement. Un changement de texture ou de sélection ne rend plus le projet artificiellement « À enregistrer ». Annuler jusqu’à l’état enregistré retrouve le badge « Enregistré ».

**Fichier projet…** prépare une copie portable `.tmskin` puis affiche un lien de téléchargement explicite. C’est une archive ZIP comprenant `project.json`, les images originales en PNG et, pour un modèle personnalisé, ses binaires. Ce format permet de transporter la configuration avec ses ressources ; un JSON seul ne pourrait pas retrouver des URLs temporaires d’images après fermeture du navigateur. L’import portable n’écrase aucune sauvegarde locale : utiliser Enregistrer pour l’ajouter à la bibliothèque.

### 12.2 Contenu conservé

- Les neuf textures : fonds, images de fond et calques indépendants dans leur ordre.
- Géométrie, rotation, taille, opacité, remplissage, contour, texte, groupes, masques, visibilité, verrouillage et liens de symétrie.
- Originaux des images, ancrage et direction des projections 3D, profondeur, familles touchées, matière individuelle et ordre des images.
- Fragments de projection et masques de matière reconstruits depuis leurs maîtres, sans les transformer en calques indépendants superflus.
- Rôle lumineux du fond, rôle de chaque élément et couleur du compteur. Les rôles différents du fond et des éléments restent distincts.
- Vue 2D/3D, caméra, intensités d’aperçu, nuit et freinage. Ces réglages sont réappliqués au moteur 3D lors de l’ouverture.
- Modèle personnalisé, aperçu GLB et fichiers complémentaires lorsque présents.

L’historique d’annulation antérieur à la fermeture ne fait pas partie du fichier. Après réouverture, les nouvelles modifications sont annulables normalement.

### 12.3 Essais réalisés dans la page ouverte

Le skin réel **MonSkin**, contenant trois images fournies dans la page, a d’abord été enregistré. Les modifications de test ont été réalisées sur une copie indépendante **Test sauvegarde locale**.

| Essai | Résultat observé |
|---|---|
| Enregistrer le skin réel | Trois images enregistrées ; miniature et carte visibles dans la bibliothèque |
| Enregistrer une copie puis renommer | Nouvelle carte indépendante ; nom retenu après ouverture et rechargement |
| Ajouter un rectangle et un groupe de phares à cette copie | Quatre éléments de carrosserie et un élément lumineux, soit cinq calques indépendants |
| Enregistrer avec Ctrl+S puis recharger complètement | Dernier projet rouvert automatiquement ; images visibles malgré la disparition des anciennes URLs temporaires |
| Retrouver le logo Chrome | Taille 75 %, angle 0°, rugosité 8/255 et métal 255/255 conservés |
| Modifier l’image après réouverture | Agrandir 75 % → 86 %, puis Annuler → 75 % ; un autre calque n’est pas déplacé |
| Déplacer le rectangle après réouverture | X 490 → 530 ; Annuler retrouve 490, rotation 23° conservée ; badge enregistré retrouvé |
| Fond de lumière et élément avec deux rôles différents | Fond « Feux de frein » et élément « Phares (nuit) » conservés ; ambiance nocturne réappliquée après correction |
| Exporter pour le jeu | Date de la sauvegarde locale actualisée avant l’encodage DDS ; téléchargement du ZIP non confirmé dans cette campagne |
| Ouvrir un autre projet avec un changement non enregistré | Proposition Enregistrer une copie / Ouvrir sans enregistrer / Annuler ; Annuler conserve la scène, puis ouverture sans enregistrer retrouve MonSkin |
| Recherche | Filtre « sauvegarde » affiche uniquement la copie de test |
| Corbeille et restauration | Copie retirée des projets actifs, retrouvée dans la corbeille puis restaurée avec sa carte et ses calques |
| Import portable depuis le sélecteur de fichiers de la page | Fichier de contrôle contenant une image UV, un rectangle, du texte et une lumière ouvert en objets distincts |
| Modifier l’image UV de ce fichier | X 250 → 280 ; rectangle conservé à X 90 et rotation 13° |
| Enregistrer ce fichier importé puis recharger | Image à X 280, rotation 27°, rugosité 235/255, métal 0/255 et opacité 80 % retrouvés |
| Visibilité, verrouillage et ordre | Texte masqué, rectangle verrouillé et image remontée d’un niveau ; mêmes états après rechargement |
| Fichier de version invalide | Refus explicite avant remplacement ; le projet courant reste ouvert |
| Desktop 1458 × 956 et 1280 × 800 | Boutons du bandeau et bibliothèque accessibles sans chevauchement ; override de taille retiré ensuite |
| Navigation au clavier dans la bibliothèque | Tab depuis la dernière action revient à Fermer ; Maj+Tab revient à la dernière action, sans focus sur le sélecteur de fichier caché |

**Limite du téléchargement dans cet environnement :** lors des essais, le navigateur intégré a déclenché puis annulé les téléchargements (`downloadProgress: canceled`, aucun octet reçu), y compris pour un lien de téléchargement natif. Aucun nouveau `.tmskin` n’a été retrouvé dans `C:\Users\sbran\Downloads`. Le fichier préparé, l’archive utilisée par la sauvegarde locale et l’import d’un fichier portable ont été vérifiés ; le téléchargement réel dans ce dossier reste à confirmer par une interaction manuelle dans le navigateur. Aucun réglage du navigateur n’a été changé pour contourner ce comportement.

### 12.4 Tests et sécurité

- Les sept suites matière, peinture d’objet, cible de peinture, illumination, placement d’image, projection 3D et fichier projet passent.
- La nouvelle suite vérifie la conservation exacte du manifeste et des PNG, les références d’images locales, les projections et masques, les groupes, les rôles lumineux, les modèles personnalisés et leurs binaires.
- Les projets importés refusent les URLs externes, propriétés de prototype, types inconnus, directions invalides, textures absentes, archives inattendues, images surdimensionnées et configurations excessivement profondes.
- Limites : archive compressée 128 Mo, décompressée 256 Mo, manifeste UTF-8 8 Mo, 300 ressources, 5000 objets, 32 mégapixels par image et 64 mégapixels pour l’ensemble des originaux. Les calques sont décodés dans des canvas temporaires avant de remplacer le projet courant.
- IndexedDB utilise des transactions ; une erreur de quota propose une copie portable. Le quota saturé n’a pas été provoqué dans le navigateur de l’utilisateur.
- Compilation réussie. Le bundle reste volumineux : environ 1 562 ko, 444 ko compressés. Lint sans erreur, neuf avertissements préexistants. `npm audit --omit=dev` ne signale aucune vulnérabilité ; aucune dépendance ajoutée.
- La suppression définitive et un modèle personnalisé réel n’ont pas été testés dans la page. Les binaires du modèle sont couverts par le test unitaire. La suppression définitive conserve une confirmation dans l’interface.

### 12.5 Portée et preuves

Les modifications postérieures au dernier **Enregistrer** ne sont pas encore sauvegardées automatiquement. Les projets locaux sont attachés à l’origine du site : changer de navigateur, de profil, d’adresse ou de port crée un autre espace. Effacer les données du site retire cette bibliothèque ; conserver un fichier portable permet une sauvegarde ailleurs.

- [Image UV éditable après import, modification, enregistrement et rechargement](audit-evidence/live-project-restored.jpg)
- [Interface de sauvegarde sur desktop 1280 px](audit-evidence/live-project-desktop-1280.jpg)
- [Bibliothèque locale](audit-evidence/live-project-library.jpg)
- [État final : MonSkin sauvegardé, copie portable préparée, essais dans la corbeille](audit-evidence/live-project-library-final.jpg)
- Données reproductibles : `scripts/create-project-audit-fixture.ts` et les fichiers `.tmskin` d’audit dans `audit-evidence`.

Le projet réel MonSkin a été rouvert à la fin, avec ses trois images. Les deux projets de test ont été placés dans la corbeille et restent récupérables. Aucune erreur de console collectée à la fin du parcours.

## 13. Première campagne sur les images lumineuses — 2 octobre 2026

Cette section conserve les résultats obtenus **avant l’analyse de KR2021_passion.zip**. Les restrictions à Détails décrites ici ont été supprimées depuis. La section 14 décrit l’état actuel et corrige la conclusion sur les lumières de carrosserie.

### 13.1 Ce que le modèle permet

Au début de cette campagne, le moteur d’aperçu de l’application reliait l’émission uniquement à **Details_I**. Il ne raccordait aucune texture d’émission aux matériaux **Skin** (carrosserie principale) et **Wheels**. C’était une limite de notre éditeur. L’analyse du skin de référence a ensuite confirmé la présence de motifs lumineux dans **Skin_I**, sans modèle personnalisé dans le ZIP.

La liste de textures provient des [ressources Stadium publiées par Ubi-Alinoa, conservées dans une archive du message officiel](https://devtrackers.gg/trackmania/p/3490d99c-stadium-car-ressources-all-you-need-to-create-skins-for-the-stadium-cars). Le raccordement des matériaux et des textures a également été vérifié dans `src/maps.ts`, `src/three/CarPreview.ts` et le script de construction du modèle.

Une texture d’illumination rend une surface lumineuse ; elle ne projette pas de lumière sur la route ou sur les objets voisins. C’est la distinction décrite dans la [documentation officielle des textures Trackmania](https://doc.trackmania.com/create/texture-mods/texture-list/).

**Correction de la conclusion initiale :** un modèle personnalisé n’est pas requis par le skin fourni pour obtenir cet effet. La liste de textures publiée en 2020 ne suffisait pas à conclure à une impossibilité. `Skin_I` est désormais pris en charge par l’application ; le rendu de notre nouvel export reste à vérifier dans Trackmania.

### 13.2 Changements réalisés

- **Correction du placement 3D :** importer une image depuis Néon / feux conserve désormais le canal lumineux. L’ancienne logique la plaçait systématiquement dans Couleur.
- **Image lumineuse directe :** projection limitée aux surfaces Détails ; un clic sur une surface sans émission affiche une explication et conserve l’image en attente de placement.
- **Lumière du logo :** le switch Image lumineuse ajoute un calque lié dans Néon / feux à une image couleur. Il conserve ses couleurs et sa transparence, avec une intensité propre et un comportement permanent, phare de nuit ou feu de frein.
- **Transformations communes :** l’image couleur, sa matière et sa lumière utilisent la même silhouette et suivent sa taille, sa rotation, sa position, son opacité, sa visibilité et son verrouillage. Les fragments dérivés restent liés à l’image maîtresse.
- **Désactivation :** éteindre puis réactiver la lumière conserve son intensité et son comportement. La suppression du calque lumineux désactive seulement la lumière, sans supprimer le logo couleur.
- **Projection entre surfaces :** les portions sur Détails peuvent briller ; les portions sur Carrosserie restent colorées. Un avertissement précise quand aucune surface Détails n’est touchée. L’activation ajoute Détails aux familles autorisées si nécessaire.
- **Réglages globaux :** appliquer un comportement à tous les calques lumineux met également à jour les configurations des images maîtresses. L’opération complète est annulable.
- **Accès :** les textures Couleur proposent les raccourcis Image lumineuse et Peindre une lumière. Les contrôles de nuit et de freinage sont aussi disponibles pendant l’édition d’un logo avec lumière liée.
- **Sauvegarde :** le projet conserve la configuration de lumière et reconstruit les calques liés depuis les images originales. Intensité hors limites, rôle inconnu, valeur non finie ou activation non booléenne sont refusés avant chargement.

### 13.3 Vérifications dans la page ouverte

Les essais utilisent la copie indépendante **Audit images lumineuses** ; MonSkin reste sauvegardé avec ses trois images d’origine.

| Essai | Résultat observé |
|---|---|
| Import d’un SVG transparent depuis le raccourci Image lumineuse | Canal Détails / Néon / feux conservé ; image en attente de placement 3D |
| Clic sur le capot principal | Refus explicite ; possibilité de choisir ensuite une surface compatible |
| Placement sur le support avant Détails | Image lumineuse ajoutée ; les trois calques de carrosserie existants restent présents, sans nouveau logo couleur involontaire |
| Rôle Feux de frein, nuit active | Logo éteint sans freinage puis allumé avec Simuler le freinage |
| Image couleur projetée avec matière et lumière liées | Les deux switches fonctionnent ensemble ; taille 115 %, rotation 15°, lumière 95 % et rôle Phares (nuit) |
| Suppression du calque Lumière lié | Image couleur toujours sélectionnable ; Annuler restaure la lumière, son intensité et son rôle |
| Comportement global Feux de frein | Rôle du logo source mis à jour ; Annuler retrouve Phares (nuit) |
| Image UV transparente dans Détails / Couleur | Lumière liée créée ; déplacement X 512 → 600 et rotation 30° ; intensité réglable de 0 à 100 % |
| Exclusion de Détails d’une projection | Avertissement visible ; le switch reste utilisable pour désactiver la lumière ; annulation retrouve les familles initiales |
| Désactivation puis réactivation | Lumière 95 % / Phares (nuit) conservée |
| Enregistrer puis recharger complètement | Trois calques lumineux retrouvés : un direct et deux liés ; six calques indépendants dans le projet complet |
| Modifier après réouverture | Image UV retrouvée à X 600 / rotation 30° ; X 620 puis Annuler → 600. Projection retrouvée à taille 115 %, angle 15° et lumière 95 % / Phares (nuit) |

Les dix suites `scripts/test-*.ts` passent. Les tests d’illumination couvrent en plus la conversion des couleurs, la conservation de l’alpha, l’absence de mutation de l’original et les bornes d’intensité. Le test du fichier projet couvre les nouveaux réglages et leurs entrées invalides. Compilation réussie, lint sans erreur avec les neuf avertissements préexistants, audit des dépendances de production sans vulnérabilité signalée. Aucune dépendance ajoutée et aucune erreur de console collectée à la fin de ces essais.

Le rendu réel en jeu n’a pas été testé. Le problème connu de téléchargement du navigateur intégré n’a pas été repris dans cette campagne.

### 13.4 Améliorations encore utiles

Les surfaces Détails peuvent être petites ou difficiles à reconnaître sur une voiture uniformément blanche. Le message de refus explique la limite ; un survol indiquant le matériau et une option pour mettre en évidence les faces compatibles aideraient davantage le placement.

L’analyse du skin de référence et l’ajout des textures manquantes sont réalisés en section 14. La validation de l’export dans Trackmania reste à effectuer. Une indication du matériau au survol aiderait à comprendre quelles textures sont touchées par la projection.

### 13.5 Preuves

- [Image lumineuse directe activée au freinage](audit-evidence/live-image-light-brake.jpg)
- [Projection avec matière et lumière propres après réouverture du projet](audit-evidence/live-image-light-restored.jpg)

À la fin, **MonSkin** a été rouvert avec ses trois calques et sans modification enregistrée de son contenu. La copie **Audit images lumineuses**, avec ses six calques indépendants, est dans la corbeille locale et reste restaurable. La page ouverte montre les nouveaux accès Image lumineuse / Peindre une lumière depuis la texture de carrosserie.

## 14. Lumières de carrosserie avec le skin KR2021

Le fichier **KR2021_passion.zip** fourni par l’utilisateur contient des motifs lumineux de carrosserie dans `Skin_I.dds` et **aucun modèle 3D personnalisé**. L’application ignorait cette texture. Elle permet maintenant d’importer, afficher, modifier et exporter les lumières de Carrosserie, Détails et Roues. Les essais d’interface ont été effectués dans la page déjà ouverte à `http://localhost:5173/`, sur desktop.

### 14.1 Analyse du fichier de référence

L’archive contient 26 fichiers. Aucun fichier GBX, GLB ou FBX n’est présent. Les quatre textures d’illumination ont une résolution de 2048 × 2048 pixels.

| Texture | Pixels lumineux détectés | Alpha des pixels lumineux | Prise en charge actuelle |
|---|---:|---|---|
| Skin_I | 28 942 | 0 à 3 | Import et édition de la carrosserie |
| Details_I | 95 097 | 97 ou 255 | Import et édition des détails |
| Wheels_I | 0 | Aucun motif lumineux | Import et édition des roues ; fond noir dans ce skin |
| Glass_I | 331 703 | 97 | Présente dans le ZIP, sans canal éditable dans l’application |

Le comptage considère lumineux un pixel dont au moins un canal RGB dépasse 20. L’image RGB de `Skin_I` contient notamment les croix, cercles et chevrons visibles sur la carrosserie. Les codes alpha proches de zéro sont simulés comme des feux de frein par l’éditeur. Cette correspondance est confirmée dans l’aperçu de l’application ; le jeu n’a pas été lancé pendant ces essais.

L’alpha de ces DDS encode un comportement lumineux. Le traiter comme la transparence d’un PNG effaçait ou affaiblissait les motifs à l’import, particulièrement ceux dont l’alpha vaut zéro. La couleur RGB est maintenant extraite avant le passage par le canvas, avec les codes alpha stockés séparément.

Les mesures et la liste des fichiers sont dans [le diagnostic de l’archive](audit-evidence/kr2021-illumination-analysis.json). L’analyse peut être reproduite avec `npx tsx scripts/inspect-reference-lights.ts <chemin du ZIP>`.

### 14.2 Corrections et accès aux outils

- **Canaux manquants :** ajout de `Skin_I` et `Wheels_I`, soit 11 textures éditables au total. Le bouton **Néon / feux** apparaît sur les trois surfaces. Les nouveaux fonds sont noirs et n’émettent aucune lumière.
- **Aperçu 3D :** chaque matériau reçoit sa propre texture d’émission et son masque de comportement. Nuit et freinage agissent sur les trois surfaces. Le compteur de vitesse reste réservé à Détails.
- **Images et dessin :** une image lumineuse directe peut être projetée sur Carrosserie, Détails et Roues. Le switch **Image lumineuse** d’un logo couleur crée ses fragments liés dans les textures lumineuses des surfaces touchées. Le pinceau 3D peut aussi peindre une lumière sur la carrosserie.
- **Réglages indépendants :** chaque élément conserve son intensité et son comportement. Le fond possède son réglage global. Appliquer un comportement à tous les calques met aussi à jour les images maîtresses ; l’ensemble reste annulable.
- **Motifs importés :** les taches lumineuses deviennent des images sélectionnables. Sur `Skin_I` du skin fourni, 67 motifs sont indépendants ; les 35 très petites taches sont réunies dans un calque supplémentaire. Cela reconstitue des éléments à partir d’une texture aplatie, sans retrouver les calques d’origine de l’auteur.
- **Codes du DDS :** les codes d’illumination importés sont conservés par pixel, séparément de l’opacité, et suivent les transformations du motif. Choisir un nouveau comportement remplace ces codes par le rôle sélectionné. L’export utilise le masque de chaque surface, avec la quantification habituelle du format BC3.
- **Sauvegardes existantes :** les projets à neuf textures sont migrés à l’ouverture en ajoutant les deux canaux noirs. Les images, groupes et réglages existants sont conservés. Les projets incomplets autres que ce format historique restent refusés.
- **Liste des calques :** le bouton Modifier la sélection reste présent et devient désactivé sans sélection. Cela évite le déplacement des lignes entre les deux clics d’un double-clic, qui pouvait ouvrir les réglages du mauvais élément.

Les avertissements limitant les logos lumineux aux seules surfaces Détails ont été retirés. Le rendu lumineux décrit une surface qui brille ; il ne constitue pas une source qui éclaire la route, comme le précise la [documentation officielle des textures Trackmania](https://doc.trackmania.com/create/texture-mods/texture-list/).

### 14.3 Essais dans la page ouverte

| Essai | Résultat observé |
|---|---|
| Import du ZIP fourni | Skin_I et Wheels_I reconnus ; motifs de carrosserie visibles dans Néon / feux |
| Simuler le freinage activé puis désactivé | Les croix et chevrons de carrosserie s’allument puis s’éteignent dans la même vue |
| Sélection d’un motif importé | Réglages individuels ouverts ; X 512 → 532 et comportement Frein → Phares ; Annuler restaure les valeurs |
| Comportement global puis annulation | Modification annulable ; le motif retrouve sa position et son comportement |
| Enregistrer puis recharger complètement la page | 69 calques lumineux de carrosserie retrouvés : 68 issus du DDS et la lumière liée à download.png |
| Modification après réouverture | Un motif reste déplaçable ; le double-clic ouvre le bon élément et Annuler fonctionne |
| Trait au pinceau dans la vue 3D | Trait cyan lumineux sur le capot ; un calque supplémentaire apparaît ; Annuler revient aux 69 calques |
| Lumière globale des roues | Fond Wheels_I passé du noir au cyan ; l’émission apparaît sur les roues ; Annuler restaure le noir |
| Logo couleur avec matière et lumière liées | Les deux switches et leurs réglages sont retrouvés après rechargement ; intensité 100 % → 0 % puis Annuler → 100 % |
| Ancien projet MonSkin | Ses trois images restent présentes après migration, sans remplacement de sa sauvegarde |

La copie **Audit KR2021 — lumières éditables** est enregistrée dans Mes projets et reste ouverte pour inspection. Les traits et changements de fond réalisés uniquement pour le test ont été annulés. Le ZIP fourni n’a pas été modifié.

### 14.4 Tests automatisés et sécurité

Les **11 suites** `scripts/test-*.ts` passent. Elles couvrent notamment les DDS, l’import et l’export des 11 textures, les coutures et pentes de projection, la matière, les images, les rôles lumineux et les fichiers projet. Les nouveaux cas vérifient les couleurs avec alpha zéro, les masques de comportement, les lumières séparées de carrosserie et de roues, l’absence de compteur parasite et la migration des anciens projets.

Les masques importés sont validés avant chargement : dimensions bornées à 1024 par axe, longueurs exactes, nombres entiers et codes de 0 à 255. Une image très fragmentée revient à une seule image éditable ; le nombre de composants est borné pour éviter des allocations excessives. Les protections existantes contre les références externes et fichiers projet malveillants restent testées.

Compilation réussie. Le lint ne signale aucune erreur et conserve neuf avertissements préexistants. L’audit des dépendances de production ne signale aucune vulnérabilité. Aucune dépendance ajoutée. Le bundle de production reste volumineux, environ 1,57 Mo avant compression ; son découpage reste une amélioration de performance à prévoir.

### 14.5 Limites à traiter

| Limite | Conséquence et suite utile |
|---|---|
| Rendu de l’export dans Trackmania non testé | Vérifier Skin_I et Wheels_I, les rôles et la luminosité dans le jeu ; l’aperçu et les tests DDS ne suffisent pas à garantir une équivalence visuelle |
| Glass_I, AO, normales et autres textures supplémentaires | Elles n’ont pas de canal éditable. Le transfert des fichiers supplémentaires est actuellement lié à la présence d’un modèle personnalisé ; la conservation intégrale des 26 fichiers de ce ZIP standard n’est pas garantie à la réexportation |
| Texture source de 2048 px éditée à 1024 px | Rééchantillonnage dans l’éditeur puis encodage à la résolution d’export. Les motifs très fins peuvent perdre du détail ; le découpage détecte les pixels au-dessus du seuil RGB 20 |
| Trois comportements simulés | Les codes alpha d’origine restent enregistrés, mais les autres comportements propres au jeu, comme certains effets associés au compteur, ne sont pas tous simulés sur tous les matériaux |
| Rechargement à chaud du code pendant l’édition | Des erreurs d’historique Fabric ont été collectées pendant les mises à jour du développement. Après rechargement complet du projet enregistré, les essais finaux n’ajoutent aucune erreur ; la restauration pendant HMR reste à fiabiliser |

Le problème déjà connu du téléchargement dans le navigateur intégré n’a pas été repris dans cette campagne.

### 14.6 Preuves visuelles

- [Carrosserie lumineuse avec simulation du freinage](audit-evidence/live-kr2021-body-braking-final.jpg)
- [Même carrosserie sans freinage](audit-evidence/live-kr2021-body-idle.jpg)
- [Motif importé avec réglages individuels](audit-evidence/live-kr2021-light-element-edited.jpg)
- [Calques retrouvés après réouverture](audit-evidence/live-kr2021-lights-restored.jpg)
- [Lumière dessinée au pinceau sur le capot](audit-evidence/live-kr2021-body-light-brush.jpg)
- [Test du fond lumineux des roues](audit-evidence/live-kr2021-wheel-light-global.jpg)
- [Logo avec matière et lumière liées après annulation du test](audit-evidence/live-kr2021-logo-light-restored.jpg)

