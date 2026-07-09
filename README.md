# TM Skin Studio

Éditeur de skins **Trackmania 2020** (voiture CarSport) dans le navigateur : on peint les
textures, on prévisualise en 3D, et on exporte un `.zip` prêt à être utilisé dans le jeu —
aucun outil externe (NVIDIA Texture Tools, Photoshop…) n'est nécessaire, l'encodage DDS
(BC1 / BC4 / BC5 avec mipmaps) est fait directement en JavaScript.

## Lancer l'application

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173

## Fonctionnalités

- **6 textures éditables** (onglets) : `Skin_B` (carrosserie), `Skin_R` (rugosité/métal),
  `Skin_CoatR` (vernis), `Skin_DirtMask` (saleté), `Details_B`, `Wheels_B`
- **Outils** : sélection, pinceau libre, rectangle, ellipse, ligne, texte (double-clic pour
  éditer), import d'images (logos, stickers), couleur de fond
- **Calques** : réordonner, masquer, verrouiller, dupliquer, supprimer ; propriétés par objet
  (couleur, opacité, contour, police, miroir, ombre)
- **Annuler / rétablir** par texture (Ctrl+Z / Ctrl+Shift+Z)
- **Guide UV** superposé (capot, côtés, avant, arrière, aileron)
- **Aperçu 3D temps réel** (three.js) sur une voiture stylisée — le modèle officiel Nadeo
  n'étant pas redistribuable, c'est un modèle simplifié dont les UV suivent le guide
- **Import** d'un skin `.zip` existant (DDS BC1/BC2/BC3/BC4/BC5 ou RGBA non compressé, PNG, JPG)
- **Export** d'un `.zip` conforme : DDS compressés avec chaîne de mipmaps complète
  (Skin_* en 2048², Details/Wheels en 1024²) + `Icon.tga` capturé depuis l'aperçu 3D

## Installer le skin dans le jeu

1. Exporter le skin (`.zip`) depuis l'application
2. Copier le zip dans `Documents\Trackmania\Skins\Models\CarSport\` (créer les dossiers si besoin)
3. En jeu : **Profil → Garage → Upload skin**, sélectionner le zip, puis l'activer

> L'accès Club est requis par le jeu pour utiliser des skins personnalisés.

## Raccourcis

| Touche | Action |
| --- | --- |
| V / B / R / E / L / T | Sélection / Pinceau / Rectangle / Ellipse / Ligne / Texte |
| Ctrl+Z / Ctrl+Shift+Z | Annuler / Rétablir |
| Ctrl+D | Dupliquer la sélection |
| Suppr | Supprimer la sélection |

## Limites connues (MVP)

- L'UV mapping de l'aperçu 3D est **indicatif** : il ne correspond pas exactement à l'UV
  officiel du modèle Nadeo. Pour un placement au pixel près, importez le template UV officiel
  (fil « Stadium Car Resources » du forum Nadeo) comme image de référence.
- L'encodage BC1 utilise une compression rapide (qualité légèrement inférieure aux outils
  NVIDIA), largement suffisante pour la plupart des skins.
- Seules les textures principales sont gérées (pas de `Glass_D`, ni de skins 3D avec
  géométrie custom, qui nécessitent NadeoImporter).

## Scripts

- `npm run dev` — serveur de développement
- `npm run build` — build de production
- `npx tsx scripts/test-dds.ts` — tests de l'encodeur DDS
