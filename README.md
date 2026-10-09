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

- **13 textures éditables en 2048 × 2048 px**, regroupées par surface : carrosserie, détails et roues.
  Couleur, rugosité/métal, néon/feux et masque de saleté sont éditables sur chaque surface ;
  la carrosserie dispose aussi du vernis.
- **Édition fluide**, activée par défaut : les textures modifiées de l’aperçu 3D passent
  temporairement en 512 × 512 px, puis retrouvent leur qualité 2048 px après une courte
  pause. Les calques, images originales et exports conservent leur précision.
  Le bouton dans la barre d’options permet de garder la pleine qualité en permanence.
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
- **Annuler / rétablir** par texture (Ctrl+Z / Ctrl+Shift+Z)
- **Guide UV et sélection précise** : cliquer sur une forme indépendante ou sélectionner
  une pièce entière, puis la remplir dans un nouveau calque éditable.
- **Aperçu 3D temps réel** (three.js) sur le modèle Stadium fourni, ou sur le GLB d'un
  projet personnalisé. Images projetées sur plusieurs surfaces, peinture et matières liées.
- **Import** d'un skin `.zip` existant (DDS BC1/BC2/BC3/BC4/BC5 ou RGBA non compressé, PNG, JPG)
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

- `npm run dev` — serveur de développement
- `npm run build` — build de production
- `npm run test:desktop-ux` — navigation sans modification des calques, focus et raccourcis du dialogue de téléchargement, erreurs d’export et URLs temporaires
- `npx tsx scripts/test-dds.ts` — tests de l'encodeur DDS
- `npx tsx scripts/test-blender-parts.ts` — contours, sélection précise, import GLB et sécurité
- `npx tsx scripts/test-part-layers.ts` — découpage des pixels, matière, lumière et migration

## Modèles 3D et construction locale

L’application peint les textures et conserve les modèles déjà compilés. Une
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
