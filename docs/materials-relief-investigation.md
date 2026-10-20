# Matières, hauteur et relief en course

## Constats établis

- L’export standard de Skion omet volontairement les normales personnalisées de carrosserie (`exportMaterialSurfaces`). Ajouter une hauteur au matériau ne modifiait pas non plus le modèle : elle était réservée à l’atelier séparé. Ce sont deux chemins distincts, et non un réglage d’amplitude manquant.
- Le test carbone antérieur concernait bien le même ZIP local, sans Club. Les audits locaux contiennent des normales BC5 non uniformes, des tangentes et un matériau de normales sur les cinq LOD. Une omission des normales sur les petits LOD n’explique donc pas à elle seule ce résultat.
- Renommer le matériau Skin avec le nom de Détails avait déjà été essayé. Il ne faut pas présenter ce renommage comme une correction validée.
- Les tests utilisateur ont confirmé le volume géométrique en course. Le test isolé du 19 octobre 2026 corrige l’interprétation initiale d’Occulte : seul le mode Volume fonctionne sur la carrosserie. Le dysfonctionnement des modèles distribués par Club reste un problème séparé.
- Les hauteurs EXR étaient converties en PNG 8 bits et limitées à [0, 1]. Ce chemin pouvait perdre des différences fines et les valeurs de déplacement négatives.

## Sources et portée

La [documentation Trackmania sur les textures](https://doc.trackmania.com/create/texture-mods/texture-list/) décrit les formats BC5 et les canaux numériques. Elle concerne les mods d’environnement : sa mention des textures `_H` **ne prouve pas** que `Skin_H.dds` déplace une voiture.

Le [message historique d’Ubi-Alinoa du 8 juin 2020, conservé par Devtrackers](https://devtrackers.gg/trackmania/p/3490d99c-stadium-car-ressources-all-you-need-to-create-skins-for-the-stadium-cars), indique OpenGL Y+, le couple rugosité/métal R/G et l’absence de normales Skin dans les possibilités de l’époque. Cette annonce n’établit pas à elle seule le comportement d’une version actuelle du jeu ; elle concorde toutefois avec la différence observée et justifie de vérifier le routage natif plutôt que d’augmenter arbitrairement la force.

Les preuves locales antérieures sont `work/relief-check/carbon-game-visibility-diagnosis.json`, `carbon-details-material-comparison-audit.json` et les confirmations utilisateur du fil. Aucun accès au code du moteur de course n’est revendiqué.

## Retour en course : Occulte, 19 octobre 2026

Le ZIP exact est `C:/Users/sbran/Documents/Trackmania/Skins/Models/CarSport/COT-TOBER - Occulte.zip`, SHA-256 `368a34cefdef1bfea0c11070a06b0bb6fd12db3256d3aef31f725eafd029afd5`. L’utilisateur avait choisi **Les deux**. Son premier retour attribuait l’effet aux normales ; un essai ultérieur isolant les modes conclut que seul le Volume fonctionne sur la carrosserie. Le retour le plus récent fait foi ; l’export combiné n’isolait pas l’origine de l’effet.

Une relecture du GBX final avec le parseur natif indépendant confirme `_DetailsDmgNormal_Skin`, normales et tangentes sur les cinq LOD. `Skin_N.dds` est présente en BC5, 2048 × 2048. La hauteur n’est pas une texture directement consommée par le jeu : les positions du maillage sont déjà déplacées, avec un maximum mesuré de 2,000109 mm. Ces mesures sont conservées dans `work/relief-investigation/audit-occulte-game-report.json`.

La conclusion produit distingue donc les chemins :

- **Carrosserie standard** : un calque seul n’exporte pas de normales personnalisées ; l’ajout d’une hauteur ne déforme pas automatiquement la voiture.
- **Carrosserie dans l’atelier** : seul le volume géométrique est proposé. Le routage de normales par shader adapté n’est pas validé et n’est plus présenté comme une fonction de production.
- **Volume géométrique** : la hauteur est intégrée au GBX avant l’export. Sa présence dans le fichier ne garantit pas un relief perceptible en course ; Occulte illustre cette limite à 2 mm. L’absence de volume visible sur ce skin ne prouve pas un rejet général des modèles déformés.
- **Détails et Roues** : normales importées ou calculées depuis la hauteur, exportées directement en DDS BC5. Le volume géométrique de chaque famille dispose aussi de son propre atelier ciblé.

La visibilité en course ci-dessus est un constat de l’utilisateur. L’audit du fichier ne remplace pas un test moteur et n’isole pas à lui seul la contribution des normales d’un export combinant plusieurs effets.

## Changements de l’application

- Trois espaces : Réglages, Textures, Bibliothèque ; rôle des images, valeurs numériques et convention OpenGL/DirectX explicites.
- Détails de surface indépendants du volume : normale importée, normale dérivée de la hauteur, combinaison ou désactivation. Détails et roues exportent les normales obtenues en BC5.
- Les packs de normales/hauteur/AO seuls créent un matériau de surface : ils ne repeignent pas la voiture et ne remplacent pas sa rugosité, son métal ou son vernis. Cette conservation reste réglable dans le projet.
- Niveau neutre et contraste de hauteur partagés par le rendu et l’échantillonnage numérique du volume. Le volume conserve son amplitude en millimètres dans l’atelier.
- Accès direct au volume depuis le matériau courant, y compris avant d’ajouter un calque. La sélection de pièces, les exclusions et le placement sont conservés. Une ancienne session de relief ne remplace plus le matériau demandé.
- Une estimation de hauteur peut être calculée par intégration des pentes des normales (projection de Frankot–Chellappa, FFT 2D). Elle est destinée aux textures répétables. La hauteur absolue et l’échelle physique ne peuvent pas être retrouvées depuis les seules normales ; l’interface le précise. Ce n’est pas une conversion en niveaux de gris de l’image bleue.
- Les hauteurs EXR sont conservées en PNG 16 bits. Les déplacements signés/hors [0, 1] sont remappés avec une information sur leur plage. Les sources PNG16 restent intactes lors des sauvegardes et exports de packs ; leur réduction passe par les valeurs numériques.

## Trois exports pour une comparaison contrôlée

Les archives sont locales dans `work/relief-investigation/`. Elles utilisent une normale volontairement large pour limiter la confusion avec un motif microscopique filtré à distance.

1. **A — normales texture, slot 2** : routage expérimental historique, avec motif large.
2. **B — normales texture, slot 1** : même contenu qu’A, hormis les cinq indices natifs de matériau déplacés vers le slot Détails existant. Teste une éventuelle différence entre résolution du nom et résolution du slot en course.
3. **C — normales inscrites aux sommets** : shader Skin standard, sans `Skin_N.dds`. Les normales tangentes sont converties dans le repère du maillage puis écrites dans les normales natives, sur les cinq LOD densifiés. La géométrie, les positions, UV, indices, rig et autres octets restent identiques au modèle standard de référence. Cela teste une méthode qui ne dépend pas de l’échantillonnage de `Skin_N` en course.

**C simule le relief par l’éclairage ; il ne crée pas de volume.** La précision dépend de la densité des sommets. Il reste un diagnostic et n’est pas proposé comme mode de production avant validation dans le jeu. `audit.json` fournit les empreintes, tailles et nombres de normales modifiées par LOD. Les archives pèsent environ 7, 7 et 11 Mo.

Comparer A/B/C avec import local, même caméra, même circuit et même éclairage, au garage puis en course. Le cas C est la priorité : s’il est visible en course, une voie de microrelief indépendante du shader de normales peut être développée. S’il échoue aussi, il faudra vérifier le chemin de rendu réellement chargé, y compris l’hypothèse d’un recalcul ou d’un remplacement des normales par le moteur de course, plutôt que changer encore l’amplitude. Ces comportements internes restent des hypothèses. Le volume géométrique reste le chemin déjà confirmé.

## Limite de validation

### Volume limité au calque

L’ouverture depuis un matériau sélectionné utilise maintenant toujours sa portée : zones, exclusions et alpha de hauteur. La commande globale de l’atelier reconnaît également le calque sélectionné. Le sélecteur « Toute la voiture » et les remplacements par des démonstrations sont retirés de ce parcours ; une carte indique le calque et ses zones. Si le calque couvre déjà toute la carrosserie, cette étendue est explicitement affichée et doit être réduite dans « Zones d’application ».

Le volume ne repeint plus la pile compositée dans l’atelier. À l’application, l’identifiant et la position du propriétaire existant sont conservés, sans création d’un matériau sur Détails/Roues ni suppression des propriétaires d’autres calques. Les normales expérimentales générées pour ce calque ne remplacent plus les normales de Détails/Roues.

Pour un modèle de relief déjà généré par l’app, les positions et normales extérieures au masque courant sont reprises sur les cinq LOD. Les UV natifs servent de signature exacte et unique pour retrouver les flux même après séparation des panneaux Détails ; une réorganisation des UV est d’abord restaurée dans le repère source. Les plages, valeurs finies et limites de déplacement sont vérifiées. Le maillage source reste intact. Les coutures physiques coïncidentes restent soudées. Les modèles incompatibles échouent explicitement au lieu de perdre silencieusement leurs volumes. Les tests vérifient deux volumes distincts, exclusions, conservation extérieure et remise à zéro du seul volume ciblé.

### Recherche web et cas Metal Pattern 011

La recherche de retours directs retrouve le créateur du [skin Lego (2021)](https://www.reddit.com/r/TrackMania/comments/p3kadg/) : il précise que ses normales fonctionnent sur les roues et Détails, tandis que les ombres de carrosserie sont dessinées. Il s’agit de son retour d’expérience, ancien, pas d’une preuve générale du rendu actuel. Aucun correctif confirmé pour faire déplacer une carrosserie standard par une simple texture de hauteur n’a été identifié dans les sources consultées. Les documents sur les `_H` de décors ne peuvent pas servir de justification pour un export voiture.

Un autre [retour direct sur les modèles distribués en jeu](https://www.reddit.com/r/TrackMania/comments/1x1wf4d/its_about_time_nadeo_stopped_breaking_3d_skins/) décrit un modèle local fonctionnel et une distribution Club qui rend les textures sur la voiture standard chez d’autres joueurs. C’est cohérent avec le problème Club déjà distingué dans ce fil, sans expliquer le cas local de normales. La cause technique avancée par ce participant n’est pas vérifiée indépendamment ici.

L’onglet utilisateur a été examiné : `metal_pattern_011`, six canaux, dont `Metal_Pattern_011_height.png` correctement affecté, calque de matériau ajouté mais pas de volume appliqué dans la session principale. Ouvrir directement « Préparer le volume 3D » utilise bien ce matériau. L’atelier calcule environ 89 000 sommets déplacés ; la capture `materiau-metal-volume-desktop.png` montre le réglage de 4,5 mm et le relief visible. Ce résultat appartient à l’atelier temporaire tant qu’il n’est pas appliqué au projet ou exporté depuis l’atelier. Le calque de matériau seul ne déforme pas le maillage.

Un export complet du navigateur a aussi été effectué séparément avec une hauteur de contrôle 16 bits, sans normales de carrosserie : `E-HAUTEUR-VOLUME-20mm.zip` (11 827 292 octets). La relecture indépendante du GBX final confirme un déplacement de positions sur chacun des cinq LOD, avec un maximum de 18,799 mm pour l’amplitude demandée de 20 mm. `audit-browser-height-volume.json` conserve ces mesures. Cette vérification prouve le passage hauteur → géométrie → ZIP, et non une nouvelle validation dans Trackmania. Elle ne prouve pas non plus que tous les matériaux fins seront correctement résolus : leur finesse reste limitée par la densité du maillage.

### Comparaison grise après le retour sur C

Le retour utilisateur sur C décrit un carbone tissé. La vérification SHA-256 confirme que le fichier C attendu a bien été généré, mais ses textures couleur et finitions carbone étaient conservées : l’observation du tissage ne prouve donc pas la visibilité des nouvelles normales.

La paire `D0-GRIS-TEMOIN.zip` / `D1-GRIS-NORMALES-SOMMETS.zip` remplace cette comparaison visuellement ambiguë. Toutes les textures DDS des deux ZIP sont identiques et uniformes : gris, rugosité constante, métal nul, AO blanche, saleté et émission nulles, normales Détails/Roues neutres, aucune `Skin_N`. D0 conserve les normales natives du modèle standard densifié ; D1 reprend les normales modifiées de C. Les positions, UV, indices, shaders et rig sont identiques. Seuls les flux de normales diffèrent dans le maillage natif ; les autres différences d’archive sont l’aperçu correspondant, l’icône de sélection et la notice. Les archives font respectivement 8,14 et 8,32 Mo. `audit-gray-pair.json` conserve les contrôles et empreintes.

Le test porte sur de grandes ondulations des reflets, pas sur une silhouette déplacée. Le retour utilisateur sur D1 est négatif : aucune ondulation attendue n’est visible dans la capture fournie. Ce retour ne valide pas cette méthode et ne permet pas d’attribuer le problème uniquement au rendu en course.

Une relecture indépendante des deux maillages finaux par le parseur GBX confirme les normales modifiées, sans se fier aux offsets du manifeste : environ 27,7° de changement médian au LOD principal, 29° sur le capot, jusqu’à 44,5°, avec des changements sur les cinq LOD. Positions, UV, indices, matériaux et rig restent identiques. `independent-gray-normal-audit.json` conserve les mesures. L’export contient donc bien une modification substantielle des normales ; leur utilisation effective par le jeu reste inexpliquée. Il serait injustifié d’annoncer un recalcul moteur comme cause établie ou de demander simplement une nouvelle hausse d’intensité. Le mode expérimental reste exclu des fonctionnalités de production ; le volume géométrique issu de la hauteur conserve la validation utilisateur antérieure.

Les tests automatisés vérifient gradients, conventions, reconstruction numérique, masques, sources 16 bits, formats, sauvegarde et mutations exactes du maillage. Ils ne remplacent pas un test du moteur Trackmania. L’interprétation initiale des normales d’Occulte est corrigée par le dernier essai isolé de l’utilisateur.

## Volume par famille et pièces mobiles, 19 octobre 2026

Les trois marqueurs correspondent aux attaches natives FAirBrake (18), RWing (26)
et LWing (25), dans `_SkinDmg_Skin`. Leur absence de volume venait du filtre
`Body`, sans constituer une impossibilité du format. Le template `full` densifie
les trois familles opaques sur les cinq LOD, garde les attributs d’origine comme
préfixes et conserve les attaches des sommets ajoutés. Le moteur soude les coutures
par famille et attache ; il ne transfère plus le déplacement entre pièces mobiles.

La hauteur est échantillonnée puis écrite dans les positions natives de
`MainBody.Mesh.gbx`. Ce volume n’est pas un layer Height interprété par TM.
L’ouverture transmet la famille active, les textures n’affectent qu’elle et les
volumes précédents des autres familles restent intacts. Les recettes UV copient
les attributs déformés pour conserver les séparations du dessous et l’atlas organisé.
Les signatures, plages, valeurs finies, quotas et empreintes sont contrôlés ;
les modèles non reconnus échouent explicitement. L’extension des pièces articulées
est testée dans le GBX et l’aperçu, avec validation du comportement en course encore
à effectuer par l’utilisateur.
