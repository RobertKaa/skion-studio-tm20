# Skion Studio

Éditeur de skins **Trackmania 2020** (voiture CarSport) dans le navigateur : on peint les
textures, on prévisualise en 3D, et on exporte un `.zip` prêt à être utilisé dans le jeu —
aucun outil externe (NVIDIA Texture Tools, Photoshop…) n'est nécessaire, l'encodage DDS
(BC1 / BC3 / BC4 / BC5 avec mipmaps) est fait directement en JavaScript.

## Lancer l'application

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173

## Fonctionnalités

- **Réorganisation réelle des UV** : en vue 2D ou côte à côte, **Réorganiser les UV**
  crée une copie du projet avec les éléments réellement déplacés et regroupés dans
  le **Calque UV**. Images, textes, peinture, fonds recadrables et matières sont
  migrés vers ces coordonnées ; le modèle d’aperçu et le modèle du ZIP utilisent
  la même disposition. Les proportions et l’orientation des motifs sont conservées.
  Les dessins répartis sur plusieurs pièces restent des groupes éditables ;
  **Élément → Dégrouper les fragments UV** permet de les modifier séparément.
  Le projet initial reste accessible dans **Mes projets**.
  **UV d’origine**, à côté de l’indicateur **UV réorganisés**, effectue la conversion
  inverse dans une nouvelle copie : les retouches actuelles, les matières, les fonds
  recadrables et le relief 3D sont conservés. Les panneaux inférieurs indépendants
  restent indépendants. La version réorganisée reste disponible dans **Mes projets**.
  La conversion reconnaît la Stadium native et les variantes de relief de l’app,
  avec leurs cinq niveaux de détail. Un modèle personnalisé inconnu est refusé
  avant mutation. Pour séparer le panneau inférieur, effectuez cette opération
  avant la réorganisation. La symétrie autour du centre de l’ancienne feuille est
  désactivée sur les UV réorganisés. Aucun logiciel externe n’est requis.
  `npm run test:real-uv` vérifie le modèle, les calques et les archives.
- **Pièces UV rangées** : en vue 2D ou côte à côte, choisir **Pièces
  rangées**. Tous les éléments sont regroupés par pièce, avec recherche et aperçus
  à proportions conservées. Un clic sélectionne la forme pour les remplissages et
  matières ; un double-clic la cadre dans l’atlas. Les trous restent attachés à leur
  contour. Cette organisation est une vue de travail : textures, modèle et export
  gardent leurs coordonnées. Les deux panneaux inférieurs indépendants sont reconnus.
  Un clic cadre aussi la surface dans l’aperçu 3D : l’angle est choisi selon les faces
  et les obstacles. Une pièce encore masquée s’affiche en **Vue isolée** ; **Voir le
  contexte / Isoler** permet de basculer, **Tout revoir** restaure la vue précédente.
  Les UV partagées proposent de passer à l’occurrence suivante (par exemple chacun
  des quatre pneus). Ces aides sont temporaires et absentes des modèles et icônes exportés.
- **Textures des pneus** : les trois zones **Bande de roulement**, **Flanc intérieur**
  et **Flanc extérieur** se sélectionnent séparément. Les aperçus rangés montrent
  le déroulé sur un tour et les flancs circulaires. Dans **Matières → Alignement**,
  **Pneu · enroulement 360°** utilise le profil et la circonférence du modèle ; en
  répétition, le pas et l’angle s’ajustent pour fermer le motif sans étirer l’image.
  **Flanc · vue circulaire** convient aux images/logos vus de face. Les cartes PBR
  suivent ce même placement. **Remplir avec une image** sur ces zones choisit
  automatiquement ce placement et ouvre ses réglages dans **Matières**.
  Une ancienne image des roues se convertit depuis
  **Élément → Enrouler sur le pneu / Poser sur un flanc**, avec source et annulation
  conservées. Les quatre pneus conservent les UV partagées du jeu. Les modèles
  personnalisés sans disposition de pneus reconnue gardent leurs contours et le
  suivi de surface générique. `npm run test:uv` vérifie ces comportements.

- **Panneaux inférieurs gauche et droit indépendants** : dans **Détails → Peindre
  une pièce**, choisir **Dessous → Élément 1**, puis **Séparer ce panneau gauche/droite**.
  Seule cette grande forme UV, partagée par les deux flancs sur la voiture d’origine,
  reçoit deux emplacements nommés **Panneau inférieur gauche** et **Panneau inférieur
  droit**. Les 596 triangles de chaque côté gardent exactement leurs positions ;
  aucun plancher ni autre détail n’est dédoublé. L’atlas d’origine est conservé une
  fois à 82 % de sa taille pour réserver une bande à la seconde forme, à la même
  échelle et sans étirement. Les dessins, sources, matières, normales, AO et feux
  sont remappés ; le projet initial reste dans **Mes projets**. Le découpage est
  conservé dans le projet et le ZIP, sur les cinq niveaux de détail du modèle.
  La voiture standard et les modèles de relief préparés par l’app sont pris en charge,
  sans Blender ni logiciel supplémentaire. Les anciennes copies de l’essai qui
  divisait tous les détails en deux restent lisibles ; elles ne sont plus proposées
  par le nouveau contrôle. Validation en jeu du découpage ciblé encore à effectuer.

- **Matériaux dans le navigateur, sans Blender ni installation** : ouvrir **Matériaux**
  à gauche ou **Matières** dans l’inspecteur.
  Les espaces **Réglages**, **Textures** et **Bibliothèque** distinguent les images
  sources de leur rendu. **Relief & hauteur** permet de choisir normales, hauteur,
  combinaison ou désactivation, puis de régler le niveau neutre et le contraste.
  **Préparer le volume 3D** transmet le matériau courant et ses zones à l’atelier,
  même avant de créer un calque. Depuis un calque sélectionné, la portée est
  verrouillée sur son masque et ses exclusions ; l’application met à jour ce
  même calque, sans recopier sa peinture sur les roues ou Détails. Les volumes
  déjà présents hors de ce masque sont conservés sur les cinq LOD.
  Les packs ne contenant que normales/hauteur/AO
  conservent la peinture et les finitions existantes. Une hauteur peut aussi être
  estimée depuis les normales : approximation explicitement indiquée, sans échelle
  physique absolue. Voir [l’investigation du rendu en course](docs/materials-relief-investigation.md).
  Six presets (peinture satinée, carbone,
  métal brossé, caoutchouc, tissu et peinture usée) et des images PNG/JPG/WebP/EXR permettent
  de créer un matériau complet. Déposer plusieurs images couleur, rugosité, métal,
  vernis, lumière, saleté, normale ou AO ; leurs canaux sont détectés et restent
  corrigeables. Les cartes ORM et rugosité/métal utilisent leurs composantes numériques.
  Répétition, taille, rotation, décalage et miroirs sont communs aux canaux. Appliquer
  à un élément UV, plusieurs pièces ou toute la surface, avec des exclusions ; glisser
  sur le matériau en 3D décale son motif en conservant son masque.
  **Placement du motif → Alignement** raccorde les images en espace 3D :
  **Voiture · dessus + Couvrir** pour une illustration sur le capot et les épaules ;
  **Suivre la surface 3D + Répéter** pour une matière qui accompagne les courbes.
  Ce suivi est le placement initial des presets, des images PNG/JPG/WebP/EXR,
  des packs Blender et des matériaux choisis dans la bibliothèque. Il utilise
  la géométrie de la carrosserie, des détails ou des roues sélectionnés. Les
  packs Skion conservent leur placement enregistré ; un bouton visible permet
  de convertir un matériau existant en suivi de surface sans perdre ses sources,
  ses zones ou ses exclusions. Les matériaux de modèles personnalisés sans nom
  de famille suivent le même atlas Skin que celui utilisé pour leur affichage.
  Ce mode calcule un repère commun sur la géométrie. Les sommets qui se touchent
  sont raccordés avant la résolution des proportions ; les petits jeux entre
  panneaux sont reliés par leurs contours, même si leurs découpes diffèrent.
  Les panneaux raccordés sont résolus ensemble pour que le motif ne reparte
  pas à zéro sur les épaules ou les prises d’air. Les pièces plus éloignées
  sont orientées et décalées vers leur voisin sans changer leurs proportions.
  Une faible contrainte de densité limite les changements d’échelle locaux.
  Le format de l’image est conservé, y compris dans les
  anciens réglages « Étirer », interprétés comme « Couvrir ». La couleur, les finitions,
  les normales et les hauteurs 16 bits utilisent les mêmes coordonnées. Sur une
  surface doublement courbe, des déformations locales restent nécessaires ;
  les retours fermés sous la voiture gardent une coupe, et les pièces éloignées
  ou les UV réutilisés conservent leurs limites.
  L’ancien mode **Envelopper en 3D**, maintenant nommé **Projection sur 3 axes**,
  mélange trois vues et peut estomper ou dédoubler un tissage sur les courbes.
  Les projections côté/face sont aussi disponibles. La position et l’échelle sont
  communes à la voiture entière ; les masques ne recentrent pas le motif. Toutes
  les cartes utilisent les mêmes coordonnées, avec les normales réorientées selon
  les tangentes UV de chaque pièce. L’export contient les textures déjà reprojetées,
  sans installation supplémentaire en jeu. Les anciens projets gardent leur mode
  **Feuille UV**. Les pièces partageant un même îlot UV restent nécessairement liées ;
  les faces qui réutilisent les mêmes texels partagent un placement unique pour
  éviter les fragments de motif sur les jantes et les petites pièces. Une
  projection de dessus s’étire sur les parois verticales, où le suivi de surface
  convient mieux aux textures répétées.
  Un seul calque contrôle couleur et finitions liées, avec annulation et sauvegarde
  des originaux dans le projet. Dans **Calques**, une finition marquée **Lié au matériau**
  ouvre directement **Matières** au clic ; le bouton de réglages fait de même. La couleur,
  la rugosité/métal et les autres sorties se modifient ensemble depuis ce panneau ;
  les finitions générées suivent le placement et l’ordre du matériau.
  Le relief personnalisé fonctionne sur Détails/Roues ;
  les presets génèrent des motifs couleur et des variations de brillance. Le carbone
  fournit aussi une hauteur et des normales du même tissage, sans images à importer.
  Les autres presets ne génèrent pas de normales. Augmenter la taille du motif
  permet de mieux le distinguer en 3D.
  Le vernis appartient à la carrosserie. Normales et AO suivent le masque dans
  l’aperçu et l’export DDS. **Mes matériaux** et **Favoris** sont sauvegardés localement
  sur cet appareil ; un pack `.skion-material.zip` permet de partager un matériau.
  Les imports sont bornés et les liens externes/scripts refusés. `npm run test:materials`
  vérifie rendu, canaux, masques, historique, projets, DDS, bibliothèque et interface.
  Les ZIP de textures Blender sont aussi acceptés : les images d’un même matériau sont
  affectées par leur nom, même dans des sous-dossiers. Le `.blend`, les aperçus et les
  fichiers non reconnus sont ignorés avec un compte rendu. Les hauteurs/déplacements
  sont conservés ; les nœuds Blender ne sont pas exécutés. Les EXR compatibles sont
  décodés en arrière-plan : hauteur en PNG 16 bits, autres canaux en PNG 8 bits.
  Les cartes numériques restent sans correction de couleur, les couleurs linéaires
  passent en sRGB. **Qualité ZIP / EXR** limite les copies importées à 1024, 2048 (défaut)
  ou 4096 px, sans modifier l’archive originale. Choisir un seul matériau, une seule
  résolution et un seul format par canal en cas de variantes. Limites : ZIP de 256 Mo,
  64 Mo par image, 128 Mo de textures et 64 millions de pixels par matériau.
- **13 textures éditables en 1024, 2048 ou 4096 px**, regroupées par surface : carrosserie, détails et roues.
  Couleur, rugosité/métal, néon/feux et masque de saleté sont éditables sur chaque surface ;
  la carrosserie dispose aussi du vernis.
  Le sélecteur **Textures** dans la barre d’options règle tous les canaux, l’aperçu 3D
  et l’export. Le choix est enregistré dans le projet ; 2048 px reste la valeur par défaut.
  Changer de résolution conserve les calques, leur placement et les images originales.
  Les textures uniformes restent optimisées sans perte à l’export.
- **Édition fluide**, activée par défaut : les textures modifiées de l’aperçu 3D passent
  temporairement en 512 × 512 px, puis retrouvent la résolution choisie après une courte
  pause. Les calques, images originales et exports conservent leur précision.
  Le bouton dans la barre d’options permet de garder la pleine qualité en permanence.
- **Aperçu 3D à la demande** : les changements de peinture, lumière et caméra
  déclenchent un rendu ; la vue se met au repos dès que la caméra est immobile.
  Les panneaux masqués et les onglets en arrière-plan suspendent le rendu.
- **Export en tâche de fond** : les canaux sont capturés puis compressés un par un
  dans un worker local. L’interface reste réactive pendant l’encodage DDS et
  l’assemblage du ZIP, avec une seule copie de pixels en transit. Les originaux,
  résolutions, rôles lumineux, modèles et sons sont préservés.
- **Chargement progressif** : le catalogue et le moteur de génération de livrées
  se chargent à l’ouverture du générateur et à la première variation.
- **Dessous de la voiture** : l’orbite 3D permet de passer sous le châssis. Le bouton
  **Voir le dessous** cadre directement cette zone pour peindre ou placer une image.
  Le sol s’efface sous la voiture et revient en remontant ; **Recadrer la vue** (`F`)
  retrouve la vue habituelle.
- **Générateur de livrées** : neuf directions originales — Endurance Prototype,
  Rallye 90, Grand Prix, Rallye Works, Stock Car, Tuning Tribal, Tuning Showcar,
  Tuning Performance et Prisme vivant — inspirées de l’endurance, de la F1, des stock-cars, du rallye
  et du tuning des années 2000. Tribaux, dragons mécaniques, flammes, déchirures
  chrome, peinture candy et néons complètent les compositions de compétition.
  La famille **Fantaisie** transforme le skin avec **Cristal astral**, **Nébuleuse**
  ou **Circuit arcanique**, sans numéro ni sponsor, avec des décors cristallins lumineux.
  Les anciens thèmes et le mode ZEvent sont retirés.
  Chaque direction possède trois compositions et cinq palettes assorties. Avec
  une graine vide, la première génération et **Nouvelle variation** tirent une
  composition, une palette et des finitions/jantes cohérentes. Les réglages fixés
  manuellement restent respectés. L’aperçu indique la composition et la palette.
  Dans le catalogue, choisir une livrée puis **Personnaliser** palette, numéro,
  peinture, pneus, patine et lumière. **Finition de la peinture** agit sur la
  carrosserie : marquages mats, décors chrome, carbone et cristaux selon le style
  conservent leurs matières. **Couleur des jantes** reste distincte de la texture
  de la gomme. **Générer une variation** crée un aperçu temporaire ; tester les ambiances et le
  **Freinage**, puis **Appliquer cette livrée** pour garder le résultat ou
  **Revenir à ma livrée** pour restaurer les calques d’origine. Chaque variation
  repart du même état, y compris avec **Conserver mes calques**.
  Les treize textures sont traitées : couleur, matière, vernis, lumière et masques
  de saleté. La patine est visible ; les masques de saleté contrôlent séparément
  la salissure en jeu. Le compteur reste allumé ; les feux arrière réagissent au
  freinage et les phares/signatures de nuit à l’ambiance. Le tuning et la fantaisie
  ajoutent des accents lumineux selon le style ; comparer Jour, Nuit et Freinage
  dans l’aperçu avant application. Les profils de pneus
  sont calibrés sur les UV Stadium. Les textures des roues personnalisées restent
  conservées. Une graine fixe reproduit le résultat ; **Nouvelle variation** essaie
  alors la graine suivante. `npm run test:generator`
  vérifie génération, alignement UV, lumière, export et anciennes préférences.
  Les vignettes sont de vrais rendus du modèle Stadium avec les textures générées,
  un angle et un studio communs ; le catalogue ne charge que neuf images WebP.
- **Activités** : Naviguer pour tourner la voiture ou déplacer la texture sans modifier
  les calques ; Décorer pour sélectionner les images, accéder aux formes et au texte
  ou à la sélection UV ; Peindre pour utiliser le pinceau et la pipette.
- **Outils** : sélection, pinceau libre, rectangle, ellipse, ligne, texte (double-clic pour
  éditer), import d'images (logos, stickers), couleur de fond
- **Calques** : réordonner, masquer, verrouiller, dupliquer, supprimer ; propriétés par objet
  (couleur, opacité, contour, police, miroir, ombre)
  Glisser la poignée d’un calque pour le placer au-dessus ou en dessous d’un autre ;
  la liste défile automatiquement près de ses bords. Les flèches restent disponibles
  et les finitions liées suivent l’ordre du matériau couleur.
- **Annuler / rétablir** par texture (Ctrl+Z / Ctrl+Shift+Z)
- **Guide UV et sélection précise** : cliquer sur une forme indépendante ou sélectionner
  une pièce entière, puis la remplir dans un nouveau calque éditable.
  **Remplir avec une image** ajuste une image sans la déformer à la sélection et
  conserve son contour fixe, même en déplaçant ou redimensionnant l’image.
  Les autres éléments restent intacts, y compris avec la symétrie activée.
- **Aperçu 3D temps réel** (three.js) sur le modèle Stadium fourni, ou sur le GLB d'un
  projet personnalisé. Images projetées sur plusieurs surfaces, peinture et matières liées.
- **Import** d'un skin `.zip` existant (DDS BC1/BC2/BC3/BC4/BC5 ou RGBA non compressé, PNG, JPG)
- **Klaxon personnalisé** : joindre un MP3, WAV ou OGG de dix secondes maximum
  depuis **Télécharger**. Le WAV mono destiné au jeu est équilibré automatiquement :
  les sons faibles sont renforcés et les pics limités avec une marge de 1 dB avant
  saturation. L’écoute dans l’app utilise ce même fichier ; le projet conserve la
  source mono intacte. Les projets existants bénéficient de ce traitement au prochain export.
- **Pièces importées séparées** : textures découpées selon le guide Stadium et les pièces
  du GLB, avec des réglages de couleur, matière, lumière et saleté par pièce.
- **Projets complets** : bibliothèque locale avec sauvegarde, réouverture, copies et corbeille ;
  fichiers `.tmskin` pour conserver les calques, les images, les textures et le modèle.
  **Enregistrer** conserve le projet dans ce navigateur, sur cet appareil. **Télécharger**
  permet de préparer un projet éditable `.tmskin` ou d’exporter un skin `.zip` pour le jeu.
  Les anciens projets en 1024 px sont convertis à l’ouverture en gardant les positions,
  proportions et masques des éléments ; leurs images originales sont conservées.
  Les images identiques sont stockées une seule fois, sans fusionner leurs calques ni
  réduire leur qualité. La sauvegarde accepte les nombreuses pièces des modèles personnalisés.
- **Export** d'un `.zip` conforme : DDS compressés avec chaîne de mipmaps complète
  (toutes les surfaces en 2048² en qualité haute ; aplats optimisés) + `Icon.tga` capturé depuis l'aperçu 3D

## Rendus et contrôle des livrées

Pour régénérer les textures, les vignettes 3D et les images du catalogue (Blender
et Python avec Pillow requis) :

```text
npx tsx scripts/render-livery-textures.ts
blender --background --python-exit-code 1 --python scripts/blender/render_livery_catalog.py
python scripts/pack-livery-catalog.py
```

Le mode `--audit` produit cinq vues par livrée en 1280 × 800 px : avant et arrière
de trois quarts, profils gauche/droit et dessus. Il conserve les vignettes du
catalogue et permet de vérifier numéros, textes, jantes et raccords UV :

```text
blender --background --python-exit-code 1 --python scripts/blender/render_livery_catalog.py -- --audit
python scripts/make-livery-audit-sheet.py
```

Les textures et rendus intermédiaires restent dans `work/livery-catalog` ; la
planche générale est `audit-contact-sheet.jpg`, avec une `audit-sheet.png` par
livrée. Inspecter les vues originales pour les petits marquages. Ce contrôle
visuel complète `npm run test:generator` et l’aperçu dans le jeu.

### Références conceptuelles

Les compositions et sponsors sont fictifs : il s’agit de créations originales
adaptées à la Stadium, pas de répliques officielles. Les références servent à
étudier la hiérarchie des numéros, les panneaux de couleur et les préparations.
La famille Tuning évoque la culture des showcars et des vinyles d’Underground 2 ;
elle applique ces décors à la géométrie Stadium, sans reproduire les voitures du jeu.
Les banques de palettes et les noms de compositions sont définis dans
`src/liveryDirections.ts` :

- [McLaren — identité des livrées F1](https://www.mclaren.com/racing/formula-1/2025/the-story-behind-mclarens-2025-livery-design/).
- [McLaren et Gulf — référence bleu glacier et orange](https://www.mclaren.com/racing/formula-1/2021/monaco-grand-prix/mclaren-racing-and-gulf-oil-international-unveil-limited-edition-monaco-grand-prix-livery/).
- [NASCAR — galerie officielle Daytona](https://www.nascar.com/gallery/paint-scheme-preview-2025-daytona-500-and-speedweeks/).
- [HKS — Time Attack et drift](https://www.hks-power.co.jp/event/wtac2018/index.html), et [GR86 Type-S, pièces carbone et supports mats](https://www.hks-power.co.jp/product/aero/gr86.html).
- [Toyota — Celica ST185 et livrée Castrol vert/rouge](https://media.toyota.co.uk/toyota-celica-st185/).

## Sélectionner et remplir un élément du guide

1. Choisir la surface et le canal à éditer : **Couleur**, **Matière**, **Néon / feux**,
   **Vernis** ou **Saleté**.
2. Activer **Zone UV** (`U`). La vue passe en Texture 2D et affiche le guide.
3. Garder **Élément précis** et cliquer à l'intérieur du contour voulu. Un petit triangle
   peut être sélectionné sans sélectionner les autres formes de sa pièce.
4. Choisir la couleur ou la finition, puis **Remplir la zone**. Le nouveau calque est
   indépendant et peut être modifié, déplacé ou annulé.

**Pièce entière** remplit tous les contours de la pièce nommée. Les listes **Zone choisie**
et **Élément** permettent également de choisir la forme sans cliquer sur le canvas.

## Modifier les textures d'un skin importé

Un nouvel import ZIP crée les calques des pièces sur chaque texture présente. Dans
**Calques**, double-cliquer sur une pièce pour ouvrir ses réglages. Les boutons
**Couleur**, **Matière**, **Néon / feux** et **Saleté** retrouvent la même pièce dans les
autres canaux. **Couleur unie** remplace ses pixels colorés ; **Annuler** restaure sa
texture. Les finitions modifient les pixels R/G de sa matière, et le comportement
lumineux peut être réglé indépendamment.

Pour un ancien projet conservant une **Texture importée** à sa position d'origine,
le panneau **Texture** propose **Séparer les pièces importées**. Une texture déjà
déplacée ou transformée doit être réimportée depuis son ZIP pour retrouver ses zones.

Un ZIP de jeu contient des textures aplaties : il ne permet pas de récupérer les textes,
logos vectoriels ou matériaux procéduraux de l'artiste. L'application reconstitue des
calques de pixels par pièce. Pour conserver sa véritable pile de calques, enregistrer
le projet dans **Mes projets** et télécharger une copie **.tmskin**.

**Réinitialiser le skin** repart de la voiture officielle et des 13 textures de base :
tous les calques, fonds importés, références et effets liés sont retirés, et les
réglages de lumière, vernis et saleté retrouvent leurs valeurs initiales. Une confirmation
prévient de la perte des modifications non enregistrées et de l’historique. Les projets
enregistrés dans **Mes projets** sont conservés ; le nouveau skin ne les remplace pas.
Pour changer uniquement la voiture, utiliser **Texture → Modèle 3D → Restaurer la voiture officielle**.
La réinitialisation complète se vérifie avec `npm run test:reset`.

Pour un modèle Blender, importer le ZIP avec **MainBody.Mesh.gbx** et **preview.glb**.
Les contours des objets sont lus dans les UV du GLB ; `skin3d.json` peut aussi fournir
leurs noms et leurs contours via `parts`. Les fichiers restent autonomes : un aperçu
GLB dépendant d'images ou de buffers externes est refusé.

## Tester le skin dans un environnement

Dans **Atelier 3D**, la barre **Environnement** propose deux vues :
**Studio** conserve une lumière neutre et constante, avec uniquement le **Freinage** à tester.
**Simulation** présente un stade procédural avec asphalte, vibreurs, tribunes et projecteurs. Les quatre ambiances
**Lever du soleil**, **Jour**, **Coucher du soleil** et **Nuit** changent le ciel, la direction
du soleil, les ombres et les reflets sur la peinture, le métal et le vernis.
Les quatre ambiances sont disponibles uniquement dans Simulation. L’ambiance sélectionnée
est conservée lors d’un aller-retour par le studio ; elle ne modifie jamais son éclairage neutre.

**Freinage** active les zones du skin affectées aux feux de frein, indépendamment de
l’ambiance. La nuit active les zones affectées aux phares ; les néons permanents restent
allumés. L’ambiance reste sélectionnée quand on change de texture et se sauvegarde dans
les projets `.tmskin`. Les projets existants restent compatibles.

Ce rendu est une approximation pour comparer les matières et les lumières, pas une
reproduction du moteur Trackmania. Les ambiances, projecteurs et reflets sont créés
localement ; aucun fichier du jeu ni téléchargement externe n’est requis. Ces réglages
ne modifient pas les textures exportées. Le résultat final reste à vérifier dans le jeu.

## Installer le skin dans le jeu

1. Dans **Télécharger**, choisir **Exporter pour Trackmania** pour obtenir le skin (`.zip`)
2. Copier le zip dans `Documents\Trackmania\Skins\Models\CarSport\` (créer les dossiers si besoin)
3. En jeu : **Profil → Garage → Upload skin**, sélectionner le zip, puis l'activer

> L'accès Club est requis par le jeu pour utiliser des skins personnalisés.

## Raccourcis

| Touche | Action |
| --- | --- |
| V / U / B / R / E / L / T | Sélection / Zone UV / Pinceau / Rectangle / Ellipse / Ligne / Texte |
| Ctrl+Z / Ctrl+Shift+Z | Annuler / Rétablir |
| Ctrl+D | Dupliquer la sélection |
| Suppr | Supprimer la sélection |
| Ctrl+S | Enregistrer le projet complet |

## Limites connues (MVP)

- Le guide des pièces standard correspond à l'atlas Stadium fourni. Un modèle personnalisé
  qui change les UV de `sBody_Lod*` ou `dDetails_Lod*` nécessite un guide adapté.
- Des objets partageant les mêmes UV partagent leurs pixels. C'est le cas des quatre
  pneus du chapeau : les peindre différemment nécessite de séparer leurs UV dans Blender.
- L'encodage BC1 utilise une compression rapide (qualité légèrement inférieure aux outils
  NVIDIA), largement suffisante pour la plupart des skins.
- Les textures du verre n'ont pas d'éditeur dédié. La création/compilation d'une nouvelle
  géométrie personnalisée passe par Blender et NadeoImporter ; l'app édite les textures
  et conserve un mesh déjà compilé à l'export.

## Scripts

Les tests, audits, modèles Blender et outils de construction 3D sont conservés
localement et exclus du suivi Git. Ils ne sont donc pas disponibles après un
clone du dépôt seul : les commandes de test et de construction ci-dessous
nécessitent ces fichiers locaux et leurs dépendances. Les sources de
l’application et les images finales de `public/` restent versionnées.

Le modèle chargé par l’aperçu est conservé dans `public/models/car/`. Les cinq
textures de relief et d’occlusion utilisées par l’application restent dans
`src/assets/model/car/`. Les archives de ressources, la copie du FBX et les
autres textures de référence sont conservées localement et ignorées par Git,
comme les outils de préparation des skins personnalisés.

- `npm run dev` — serveur de développement
- `npm run build` — build de production
- `npm run test:desktop-ux` — navigation sans modification des calques, focus et raccourcis du dialogue de téléchargement, erreurs d’export et URLs temporaires
- `npm run test:performance` — rendu 3D au repos/reprise, export séquentiel en worker, fichiers identiques, libération des buffers, erreurs et aperçu adaptatif
- `npm run test:region-image` — remplissage image sur une sélection UV, contours et trous, proportions/orientation, treize canaux, historique, projet et sécurité
- `npm run test:texture-size` — 1024/2048/4096, précision des originaux, UV/groupes/feux, projets, dimensions DDS, textures GPU et sélecteur accessible
- `npx tsx scripts/test-dds.ts` — tests de l'encodeur DDS
- `npx tsx scripts/test-blender-parts.ts` — contours, sélection précise, import GLB et sécurité
- `npx tsx scripts/test-part-layers.ts` — découpage des pixels, matière, lumière et migration

## Modèles 3D et construction locale

### Textures et relief v1.0

Dans **Matières → Textures et relief · v1.0**, choisissez le carbone intégré,
un matériau sélectionné ou un pack ZIP/images. Le fichier `.blend` est ignoré :
aucune installation de Blender, Python ou autre outil n’est nécessaire.

Le mode **Volume** utilise désormais une surface Body densifiée, préparée pour
les cinq niveaux de détail natifs. Elle échantillonne la hauteur localement ;
les PNG gris/RGB 8 ou 16 bits non entrelacés sont lus numériquement, sans gamma
ni conversion préalable en atlas 8 bits. Les hauteurs EXR deviennent des sources PNG
16 bits, y compris pour les déplacements signés remappés vers [0, 1]. La répétition, rotation,
miroirs, décalages, masques et opacité suivent le placement du matériau.
Les cartes d’un ZIP Blender restent disponibles jusqu’à 4K, indépendamment de
la qualité d’export. La résolution de la surface reste fixe : de très petites
fibres peuvent encore être plus fines que ses sommets.

L’amplitude usuelle va de 0 à 30 mm dans chaque sens. **Relief marqué · 20 mm**
facilite les essais de pierre ; le carbone démarre à 0,5 mm. La comparaison
**Sans relief** garde la même apparence. Les diagnostics gris et l’amplitude
extrême 80 mm sont accessibles dans les options avancées.

**Appliquer au projet** installe le modèle et ajoute des matériaux éditables
pour la couleur et les finitions. Les calques existants sont conservés ; une
nouvelle application remplace les calques créés par cet atelier. Une carte de
hauteur seule conserve la peinture. **Enregistrer** et le fichier `.tmskin`
conservent le modèle, les sources PNG exactes et les réglages du relief.
Les projets contenant leurs sources 4K disposent d’une capacité de 192 Mo ;
les ressources identiques sont partagées, avec des limites d’expansion et de
pixels conservées. Cette capacité concerne le projet éditable, pas le ZIP du jeu.
Rouvrez l’atelier pour modifier la hauteur : modifier la peinture d’un calque
ne recalcule pas automatiquement la géométrie.

**Exporter le skin** crée un ZIP complet avec mesh, squelette, animation,
textures, klaxon éventuel et `preview.glb`. L’export principal après application
utilise le même budget prudent de **24 Mo**, avec des réductions mesurées des
canaux secondaires. La couleur Skin peut rester en 4K ; les autres couleurs et
normales sont plafonnées à 2K puis certaines finitions à 1K si nécessaire.
Un ZIP encore trop gros est refusé. Cette cible est une politique de l’app,
choisie après un rejet 4K, et ne constitue pas une limite officielle du jeu.

Le volume des galets densifiés a été confirmé par l’utilisateur **en course
sur PC le 14 octobre 2026**, avec des captures grises et texturées.
Le volume concerne les panneaux fixes Skin. Les roues, pièces Details, verre
et articulations gardent leur géométrie ; les raccords sont atténués sur 3 cm.
La couleur et la finition peuvent couvrir Skin, Details et Wheels, avec les
variations d’échelle et d’orientation liées à leurs UV.

**Normales** et **Les deux** restent expérimentaux sur la carrosserie : le
carbone testé avec le même ZIP local montre son relief au garage, mais peu en
course. Le shader DetailsDmgNormal associé peut aussi changer le vernis.
Ce point est distinct des anciens accessoires Blender rétablis par réimport
local mais absents via un Club. La cause et le ZIP distribué par les Clubs
n’ont pas été comparés ; la distribution Club et la console restent à vérifier.

Les modèles neutres vérifiés par SHA-256 sont chargés à l’ouverture depuis
`public/models/relief/dense/`. Le navigateur ne parse ni n’exécute de GBX ou de
`.blend` arbitraire. `scripts/prepare-dense-relief.py` et
`scripts/dense_heightfield_core.py` sont les outils de préparation développeur.
Les sources natives et le rig local servent uniquement à régénérer ces assets.
`npm run test:relief` vérifie PNG16, inflation bornée, sauvegarde, cinq LOD,
interfaces articulées, archives, comparaison et atelier desktop.

En dehors du relief intégré, l’application conserve les modèles déjà compilés. Une
nouvelle géométrie demande Blender, NadeoImporter et les outils locaux de
construction ; changer uniquement la peinture ne demande pas de recompilation.

Le pipeline générique `scripts/blender/skin3d_blender.py` exporte le FBX,
`preview.glb`, les matériaux et `rig-validation.json`. Ensuite,
`scripts/build-3d-skin.ps1` appelle NadeoImporter et skinfix, corrige l’ordre des
os puis contrôle le GBX avant de préparer les archives. Configurer les chemins
de Trackmania, NadeoImporter, skinfix, Python avec `construct` et gbx-py dans
`scripts/3d-skin.local.json`, à partir de l’exemple local. Le build refuse un
export sans rapport de rig valide ou dont les empreintes ont changé.

Ce pipeline effectue des contrôles de structure, de poids, de pivots et d’UV.
Il ne garantit pas le comportement d’un nouveau modèle dans le jeu ni sa
visibilité chez les autres joueurs. Les modèles natifs conservés ci-dessous
ont aussi leurs propres outils de construction ; les recompiler avec une
ancienne méthode ne constitue pas une mise à jour validée.

### Sources et livraisons conservées

Les sources Blender, projets et archives ci-dessous sont des fichiers locaux
ignorés par Git. Les audits, captures et variantes rejetées sont exclus du
suivi Git ; les dossiers de livraison et leurs sources éditables sont conservés.

| Projet | Source éditable | Fichiers d’utilisation |
| --- | --- | --- |
| Sphères V3 | `work/steel-ball-native-v3/stadium-steel-balls-native.blend` | `steel-ball-native-v3.zip` pour le jeu ; `steel-ball-native-v3-app.zip` pour l’import complet dans l’app ; `steel-ball-native-v3-model-update.zip` pour remplacer uniquement le modèle |
| Chapeau V8, fenêtre avant | `work/witch-hat-native-v8-front-window/stadium-witch-hat-v8-cockpit.blend` | `Witch-Hat-Native-V8-Fenetre-Avant.zip` pour le jeu ; `skin3d-project.zip` pour l’import complet ; `model-update.zip` pour remplacer uniquement le modèle |
| Citrouille | `work/citrouille-nez/pumpkin-test.blend` | `citrouille-nez.zip` et `skin3d-project.zip`, dans le même dossier |
| Base Stadium originale | `templates/stadium-original/stadium-original-rig.blend` | Base texturée et riggée pour créer une copie de travail ; consulter `LIRE-MOI.txt` |
| Lanterne | `work/lanterne/Lanterne.blend` | Projet Blender de départ avec la Stadium originale texturée ; aucun accessoire ajouté ni skin de jeu final livré |

Les noms d’archives du tableau sont relatifs au dossier de leur projet.
Conserver le ZIP pour le jeu et le projet éditable séparément : un ZIP de jeu
seul ne contient pas nécessairement l’aperçu GLB requis pour afficher les
accessoires dans le navigateur. Garder ensemble les fichiers GBX du modèle,
du squelette et des animations fournis avec chaque livraison.

### Remplacer le modèle sans perdre la peinture

Importer `model-update.zip` dans le projet ouvert pour remplacer la géométrie
et son aperçu tout en conservant les calques. Importer `skin3d-project.zip`
charge aussi les textures de cette archive. Télécharger une copie `.tmskin`
pour garder les calques éditables et les images originales.

L’outil local `scripts/repack-skin-mesh.ts` prépare ces archives à partir d’un
ZIP de jeu existant et d’un dossier contenant le mesh compilé et son aperçu.
Le fichier facultatif `parts.json` conserve les contours UV nommés des pièces.
Cet outil réassemble des fichiers ; il ne répare pas les animations du jeu.

### Préparer les ressources de réorganisation UV (développement)

`public/models/uv-atlas/manifest.json` et `recipes.bin` contiennent les recettes
authentifiées. Le navigateur copie les attributs natifs, duplique uniquement les
sommets partagés entre pièces et remplace les UV0 et indices associés. Positions,
normales, UV secondaires, poids et animations sont conservés. Les contours
incluent les marges nécessaires aux cinq LOD.

Pour régénérer ces ressources, utiliser les mêmes sources/parser locaux que
`prepare-relief-prototype.py` et les variantes de panneaux déjà préparées :

```bash
npx tsx scripts/prepare-uv-atlas-plans.ts guides
python scripts/prepare-uv-atlas.py scan
npx tsx scripts/prepare-uv-atlas-plans.ts plans
python scripts/prepare-uv-atlas.py build
npm run test:real-uv
```

Python et ces sources locales servent uniquement à préparer les ressources du
projet. L’application publiée fonctionne entièrement dans le navigateur.
