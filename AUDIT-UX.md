# Audit de TM Skin Studio

> Historique des premières observations. Pour l’état actuel, les corrections, les tests dans la page ouverte et le périmètre desktop uniquement, consulter [AUDIT-DESKTOP.md](AUDIT-DESKTOP.md).

**Date :** 2 octobre 2026  
**Périmètre :** parcours de création d’un skin vierge, organisation des outils, aperçu 2D/3D, génération, import/export, ergonomie desktop/mobile, tests et sécurité du traitement local des fichiers.

## Synthèse

TM Skin Studio est un éditeur riche et spécialisé : les neuf textures/canaux de peinture sont accessibles, le rendu 3D accompagne le dessin, les formes sont éditables en calques et l’export produit un ZIP directement utilisable dans Trackmania. Le cœur technique d’import/export paraît robuste au vu des tests disponibles.

Le principal problème est l’entrée dans l’outil : les contrôles sont nombreux et visibles simultanément, les libellés supposent une connaissance des textures et des UV, et l’interface n’a pas de mode mobile dédié. L’éditeur gagnerait à guider les nouveaux utilisateurs de la création jusqu’à la vérification en jeu, tout en gardant un espace de travail rapide pour les habitués.

## Constats prioritaires

| Priorité | Constat | Conséquence | Recommandation |
|---|---|---|---|
| **P1** | La grille principale reste composée d’un rail de 52 px et d’un inspecteur de 296 px, quelle que soit la largeur (`src/index.css`, `.body`). Aucune règle mobile ne recompose l’éditeur. | Sur téléphone ou petite tablette, il reste trop peu de place pour la texture et les outils; les actions du haut se concurrencent aussi. | Créer un mode compact avec panneau inspecteur en tiroir, barre d’outils basse ou défilante, commandes principales persistantes et canvas prioritaire. Tester au minimum 360, 390, 768, 1024 et 1440 px. |
| **P1** | Les trois familles (Carrosserie, Détails, Roues), puis leurs canaux (Couleur, Matière, Vernis, Saleté, Néon) sont présentés comme des boutons de même niveau que les actions de texture. | La différence entre une pièce, une texture et un canal n’est pas immédiatement claire. Les noms techniques et les fichiers DDS sont difficiles à interpréter pour un débutant. | Organiser en étapes visibles : **Pièce → Apparence → Outil → aperçu**. Ajouter un court descriptif au premier choix et renommer les canaux en langage d’usage (« Couleur », « Brillance / métal », « Vernis », « Usure », « Lumière »), avec la terminologie technique en aide secondaire. |
| **P1** | La vue initiale expose à la fois toute la texture UV, un rail de huit outils, les contrôles de peinture, l’inspecteur, les couches et les actions globales. | Charge cognitive élevée et découverte par essais/erreurs; peu d’indication sur le prochain geste à faire. | Proposer un démarrage court (« Peindre », « Importer un skin », « Générer une base »), un parcours en 3–4 étapes avec possibilité de passer, et des infobulles d’aide à la première utilisation. Garder l’éditeur complet accessible sans onboarding récurrent. |
| **P2** | Les noms de pièces sont nombreux et utilisent parfois des abréviations (« JANTES AV. », « BAS DE CAISSE G. »). Le panneau de pièces devient long et défile indépendamment. | Difficile de savoir quelle zone est sélectionnée et où elle se trouve sur la voiture. | Ajouter un surlignage simultané de la pièce sur UV et voiture 3D, recherche/filtre et états sélectionnés plus explicites. Regrouper les pièces par zones avant/arrière/côtés. |
| **P2** | La prévisualisation 3D est intégrée dans l’inspecteur en 2D, puis séparée dans les modes 2D+3D et 3D. Le changement de mode est une commande globale discrète. | Certains utilisateurs peuvent ne pas remarquer que la voiture suit la texture ou confondre l’aperçu avec une zone éditable. | Nommer explicitement les vues (« Texture », « Texture + voiture », « Voiture »), rendre le retour de synchronisation évident, et faire du mode côte à côte le choix par défaut sur écran large. En compact, utiliser un basculement clair entre texture et aperçu. |
| **P2** | Après génération, la fenêtre présente « Annuler et fermer », « Conserver » et « Régénérer », mais le résultat et le nombre de textures modifiées sont les informations principales. | Bon mécanisme de retour arrière, mais la décision de validation repose sur des libellés et une graine difficiles à comprendre au premier abord. | Renommer les actions « Revenir à ma version » et « Garder cette livrée », expliciter que la génération remplace/modifie les textures concernées, et afficher une comparaison avant/après ou une confirmation visuelle de ce qui sera conservé. |
| **P2** | L’export se termine par un toast de réussite et une instruction textuelle de placement du ZIP. | L’utilisateur peut ne pas savoir où le fichier a été téléchargé ni comment l’installer dans le jeu. | Afficher un panneau de fin avec le nom exporté, le chemin de destination du navigateur si disponible, les étapes d’installation et un lien vers l’aide. Garder un retour lisible en cas d’échec. |
| **P3** | L’interface utilise des icônes et raccourcis efficaces, mais les libellés des outils sont dans la barre supérieure uniquement après sélection; certains contrôles de précision sont repliés. | Découvrabilité limitée au clavier ou à la souris pour les nouveaux utilisateurs; sur mobile les raccourcis n’aident pas. | Conserver les raccourcis et ajouter une aide regroupée (« ? »), labels accessibles cohérents et gestes tactiles pour zoom/pan. Vérifier focus visible, navigation clavier et tailles de cible sur mobile. |

## Parcours observés

1. **Ouverture / skin vierge :** l’éditeur se charge avec la texture UV carrosserie, le guide de pièces, l’inspecteur et l’aperçu voiture. L’état initial est compréhensible pour un utilisateur déjà familier avec un éditeur UV, mais ne donne pas de prochaine action guidée.
2. **Changement de famille :** passage de Carrosserie à Détails confirmé; les canaux disponibles et la carte UV changent comme attendu. Les descriptions d’aide expliquent les canaux, mais en texte dense.
3. **Calques :** le panneau Calques affiche un état vide avec une incitation à dessiner ou ajouter une forme/texte/image.
4. **Générateur :** la fenêtre s’ouvre avec de nombreux choix détaillés et une prévisualisation. Une génération a modifié neuf textures, annoncé une graine reproductible et activé les commandes de validation/annulation. « Annuler et fermer » a restauré l’état précédent.
5. **Export :** le ZIP est produit depuis l’éditeur et un message de réussite explique le dossier du jeu. Le téléchargement n’a pas été importé dans Trackmania pour vérification en jeu.
6. **Vue 3D :** le mode plein cadre fonctionne et présente les gestes de rotation, déplacement et zoom ainsi qu’une commande de recadrage.

**Limite du test manuel :** aucun ZIP utilisateur ou fichier d’exemple n’était fourni; l’import par le sélecteur de fichier n’a donc pas été vérifié dans le navigateur. Les chemins d’import ont été couverts par les tests techniques existants, y compris ZIP partiel, archive ancienne/récente et DDS tronqué.

## Proposition de structure d’interface

### Desktop

- **Barre supérieure :** nom du projet et statut de sauvegarde, Annuler/Rétablir, Importer, Exporter. Garder « Générer » accessible comme action de démarrage, mais éviter qu’il concurrence l’export.
- **Navigation d’édition :** onglets de famille compacts, puis canaux clairement groupés sous la famille active.
- **Zone centrale :** texture dominante avec guide d’UV activable, contrôles de zoom visibles, et vue voiture synchronisée qui peut s’agrandir.
- **Rail latéral :** outils de dessin avec libellé au survol, raccourci affiché et regroupement Sélection / Dessin / Ajout.
- **Inspecteur :** onglets Propriétés et Calques; propriétés contextuelles uniquement pour la sélection active; liste des pièces avec recherche et surlignage UV/3D.
- **Progression facultative :** un bandeau discret « 1. Base · 2. Décoration · 3. Finitions · 4. Export » aide sans enfermer dans un wizard.

### Mobile et tablette

- Une seule zone de travail à la fois, avec sélecteur **Texture / Voiture** et bascule vers l’inspecteur en tiroir.
- Barre d’outils tactile en bas ou panneau défilant horizontal, cibles d’au moins 44 px, gestes pincement pour zoom et glissement pour déplacer.
- Canaux en menu/segments défilants, nom complet du canal actif toujours visible.
- Actions d’import/export dans un menu persistant et états de traitement visibles; modales en plein écran avec actions fixées en bas.
- Ne pas tenter d’afficher en parallèle UV, aperçu 3D, propriétés et rail à largeur téléphone.

## Vérifications techniques et sécurité

- `npm run build` : **réussi**. Vite signale toutefois un bundle JavaScript minifié d’environ **1,47 Mo** (419 Ko gzip), au-dessus du seuil de 500 Ko; envisager un découpage dynamique de l’éditeur 3D/générateur.
- `npm run lint` : **réussi avec avertissements**. Avertissements dans les scripts de génération UV et dépendances d’un `useEffect` dans `src/App.tsx`.
- `npx.cmd tsx scripts/test-import-zip.ts` : **tous les tests passent**, incluant ZIP partiel, compatibilité ancienne/récente, entrée DDS tronquée et import de projet 3D.
- `npx.cmd tsx scripts/test-export.ts` : **tous les tests passent**, neuf textures, formats DDS, mipmaps, canaux d’illumination et fichiers de projet 3D.
- `npx.cmd tsx scripts/test-dds.ts` : **tous les tests passent**, codecs BC1/BC3/BC4/BC5, dimensions et conversions.
- La préférence du générateur est enregistrée dans `localStorage`; le parseur valide les enums, hexadécimaux, booléens et nombres avant utilisation, et gère les erreurs de stockage.
- L’import inspecte les noms de fichiers et les dimensions des images; les bitmaps limitent les dimensions à `MAX_IMPORT_DIM`. En revanche, l’archive est lue intégralement en mémoire par JSZip (`file.arrayBuffer()` puis `loadAsync`) et aucune limite explicite de taille du ZIP, de taille décompressée totale ou de nombre d’entrées n’apparaît dans le chemin inspecté. Pour éviter qu’une archive démesurée ou fortement compressée épuise la mémoire du navigateur, imposer des plafonds documentés avant/après décompression et un maximum d’entrées, puis ajouter un test de rejet correspondant.
- L’aperçu 3D et les fichiers restent dans le navigateur; aucune transmission externe n’a été observée dans les parcours testés. L’export local est déclenché par l’interface.

## Plan d’amélioration conseillé

1. **Réduire le risque mobile et clarifier l’espace de travail** : définir les points de rupture, tiroir d’inspecteur et ergonomie tactile, puis valider par capture aux tailles cibles.
2. **Simplifier la première utilisation** : actions de départ, vocabulaire orienté utilisateur, aide des canaux/UV et progression non bloquante.
3. **Rendre la sélection de pièce tangible** : liaison visuelle stable entre nom, région UV et voiture 3D, filtres et regroupements.
4. **Durcir l’import et compléter ses retours** : plafonds ZIP/entrées/décompression, rapport d’import clair (textures reconnues, ignorées, erreurs) et tests d’archives surdimensionnées/corrompues.
5. **Améliorer le retour d’export et les performances** : instructions d’installation plus actionnables, découpage du bundle lourd et audit du chargement initial.

## Complément : tests approfondis du dessin et de l’aller-retour ZIP

Ces vérifications ont été faites dans l’éditeur interactif après l’audit initial.

### Dessin et édition

- **Rectangle :** sélection de l’outil, glisser sur le canvas, création d’un objet sélectionné et édition de ses propriétés réussies. Le panneau expose remplissage, opacité, contour, pointillés, position, taille, rotation, miroir, ombre et duplication/suppression.
- **Pinceau :** un trait rouge a été tracé par glisser; le trait apparaît immédiatement sur la texture et la voiture 3D est mise à jour. Le panneau donne une taille (18 px par défaut), la couleur et un lissage réglable (35 %). Le trait devient un calque « Coup de pinceau ».
- **Texte :** le clic crée un texte « Texte » directement sur la toile en mode édition. Remplacement par « TEST », validation en cliquant hors du texte et conservation comme calque ont fonctionné. Le débutant peut comprendre l’édition, mais les options de police et taille sont absentes de la première vue du panneau Calques; elles sont à retrouver en sélectionnant le texte et en restant dans Propriétés.
- **Ellipse :** création par glisser, présence comme calque et édition de position/taille confirmées.
- **Annuler / Rétablir :** le trait a été retiré avec Annuler, puis restauré avec Rétablir; le nombre de calques a suivi l’opération.
- **Placer sur une pièce :** choix de « TOIT / CAPOT », puis « Centrer et aligner sur la voiture » a déplacé l’ellipse, réglé sa position et sa rotation, et rendu son effet visible en 3D. Le modèle de décalque reste libre : il n’est pas rogné à la pièce, ce qui est cohérent pour un decal; l’option **Isoler** et le remplissage exact servent au cas de peinture contrainte.
- **Remplissage exact :** clic d’une pièce carrosserie puis Remplir a créé un calque groupe d’aplat bleu correspondant au contour UV de la pièce; l’aperçu 3D a reflété la couleur sur la carrosserie. Le groupe s’est placé au-dessus des dessins déjà présents, ce qui les masque dans la texture : expliquer clairement l’ordre des calques et permettre de déplacer le groupe aide à éviter la surprise.
- Les outils testés sont utilisables à la souris. La palette expose aussi Ligne, Polygone, Pipette, image, grille, symétrie et guides, mais tous ces outils n’ont pas été exercés dans ce complément; le pinceau tactile/stylet n’a pas été vérifié.

### Import d’un ZIP déjà exporté

- Un ZIP d’export précédent, `MonSkin (7) (1) (1).zip`, a été relu depuis le dossier Téléchargements. Le chemin d’import ZIP a reconnu **les neuf textures** (`Skin_B`, `Skin_R`, `Skin_CoatR`, `Skin_DirtMask`, `Details_B`, `Details_R`, `Details_I`, `Wheels_B`, `Wheels_R`) sans erreur. `Icon.tga` est signalé comme ignoré.
- Un second parcours complet a été exécuté dans un navigateur isolé sur l’application locale : création de **Rectangle**, **Texte « ROUNDTRIP »** et **Coup de pinceau** (3 calques), export, rechargement propre de l’application, puis réimport du ZIP. Le navigateur a bien émis un événement de téléchargement pour `TM_Skin_Studio_Roundtrip_1790900623447.zip`, enregistré dans le dossier Téléchargements Windows (**66 419 octets**). L’interface confirme « 9 texture(s) importée(s), 1 ignorée(s) »; l’entrée ignorée est `Icon.tga`.
- Après réimport propre, les trois objets de `Skin_B` réapparaissent visuellement, mais le panneau Calques ne contient qu’un calque **Texture importée**. Les formes/texte/traits ont donc été aplatis dans `Skin_B.dds`; il est possible de sélectionner et déplacer l’image entière, mais **pas de récupérer ni déplacer les composants indépendamment**. Les autres textures importées deviennent également chacune une image aplatie dans leur carte; les zones lumineuses de `Details_I` peuvent être séparées en îlots, sans restituer les calques d’origine.
- L’inspection du ZIP confirme qu’il ne contient que les neuf fichiers DDS, `Icon.tga` et `ReadMe.txt`, sans fichier de projet ou description des calques. Le format d’export Trackmania sert au rendu en jeu; il ne conserve pas la structure du projet de l’éditeur.
- Les tests automatisés existants vérifient également l’aller-retour ZIP et l’import des textures; ils passent. L’import interactif complet est maintenant vérifié via navigateur isolé et injection du fichier exporté dans le contrôle ZIP.

### Conclusions ajoutées

- Les outils de base sont fonctionnels et fournissent des options de retouche assez riches pour un éditeur de livrée; la création de formes, de texte et de traits est rapide.
- Le point faible n’est pas le manque d’outils, mais la découverte de la relation **pièce ↔ îlot UV ↔ calque ↔ résultat 3D**, ainsi que la visibilité des réglages avancés.
- Le ZIP Trackmania est un format aplati. Pour retrouver les calques et pouvoir les déplacer après fermeture/réimport, il faut ajouter un format **Projet TM Skin Studio** distinct du ZIP Trackmania, qui sérialise les objets Fabric (type, géométrie, transformations, styles, ordre, visibilité/verrouillage) et les textures/imports nécessaires. Garder l’export Trackmania comme export de rendu final.
- L’événement de téléchargement a été reçu et l’archive sauvegardée dans le dossier Windows demandé lors du test automatisé. La difficulté précédente à localiser le fichier provenait du parcours d’observation du navigateur, pas d’un échec reproductible de l’export.

## Critères de validation d’une refonte

- Un nouvel utilisateur peut créer une couleur de base, tracer une forme, voir son effet sur la voiture et exporter sans connaître le nom des fichiers DDS.
- Tous les outils principaux restent atteignables à 360 px sans défilement horizontal global.
- Le changement de pièce ou de texture indique visuellement ce qui est sélectionné et où cela se trouve sur UV/3D.
- Une archive invalide, géante ou partiellement valide produit un message compréhensible sans bloquer l’onglet.
- Les parcours existants de génération avec annulation, import et export gardent des tests automatisés de non-régression.
