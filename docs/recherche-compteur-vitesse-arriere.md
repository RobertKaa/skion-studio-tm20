# Recherche : chiffres de vitesse à l'arrière du véhicule (TM2020)

> Document de recherche pour TM Skin Studio — juillet 2026.  
> **Conclusion courte** : les chiffres de vitesse à l'arrière ne sont **pas** contrôlables via les textures de skin. Ce sont des affichages gameplay gérés par le moteur. TM Skin Studio ne peut pas (et ne devrait pas) ajouter une map dédiée pour cela.

---

## 1. De quoi parle-t-on exactement ?

Dans Trackmania 2020, la voiture Stadium affiche **en temps réel** des informations à l'arrière du véhicule pendant la conduite :

| Élément | Description | Contrôlable par skin ? |
|--------|-------------|------------------------|
| **Compteur de vitesse** (chiffres qui changent) | Vitesse actuelle affichée sur le panneau arrière (« speedometer ») | **Non** |
| **Position / classement** | Numéro de place en course (multijoueur) | **Non** |
| **Dossard** (trigramme 3 lettres + 2 chiffres) | Identifiant joueur superposé sur la carrosserie | **Non** (plugin OpenPlanet) |
| **Indicateur de vitesse (vitres / « glass gears »)** | Rapport de vitesse visible à travers le pare-brise | **Non** |
| **Feux arrière / frein** | Zones lumineuses réactives | **Partiellement** via `Details_I` (couleur d'émission des feux custom, pas les chiffres) |
| **Numéro de course peint** (décoratif sur les flancs) | Chiffres dessinés dans la texture `Skin_B` | **Oui** — déjà géré par le générateur (`raceNumber`) |

Sources :
- [Crashs-Tests.fr — Test TM2020](https://www.crashs-tests.fr/news/article/read/name/Un-nouveau-Trackmania-le-5-Mai-2020.html) : « La vitesse et la position sont affichés en temps réel à l'arrière du véhicule » ; en replay, le HUD nom+position disparaît mais la vitesse reste.
- [Otakugame.fr — Test TM2020](https://otakugame.fr/test-trackmania-2020-le-retour-dune-legende/) : la vitesse est inscrite sur l'arrière du véhicule pour garder les yeux sur la route.
- [Nadeo Dev Tracker — Stadium CAR Resources](https://devtrackers.gg/trackmania/p/3490d99c-stadium-car-ressources-all-you-need-to-create-skins-for-the-stadium-cars) : liste officielle des limites du skinning.

---

## 2. Ce que dit Nadeo officiellement

Citation exacte du fil ressources Stadium CAR (Ubi-Alinoa, mis à jour 2020) — section **« What you can't do »** :

> - modify the gameplay displays on the car (**player position / ID** ; **turbo color** ; **digits color : rear lights and glass gears**)

Traduction / interprétation :
- **player position / ID** → affichage de la place et de l'identifiant joueur
- **turbo color** → couleur de l'indicateur turbo
- **digits color : rear lights and glass gears** → couleur des **chiffres** des feux arrière et de l'indicateur de rapport dans le verre

Il n'existe **aucune texture** (`Skin_*`, `Details_*`, `Glass_*`) permettant de choisir la couleur ou le contenu des chiffres de vitesse. Le moteur les dessine par-dessus le modèle.

Côté ManiaScript, le module `CModulePlaygroundSpeedMeter` expose des méthodes de visibilité et d'échelle (`SetSpeedLineVisible`, `SetGaugeBGVisible`, `SetGlobalScale`, etc.) — preuve que c'est un **widget gameplay**, pas une map DDS :
- [ManiaScript — CModulePlaygroundSpeedMeter](https://maniascript.boss-bravo.fr/class_c_module_playground_speed_meter.html)

---

## 3. Confusions fréquentes

### A. Numéro de course peint (flancs / capot)
Notre app peut dessiner un **numéro décoratif** dans `Skin_B` (générateur → option « numéro de course »). Ce n'est **pas** le compteur de vitesse : c'est de la peinture statique sur la carrosserie.

### B. Dossard (texte dynamique)
Le dossard (trigramme + numéros) est un overlay gameplay. Plugin [DossardPlus](https://openplanet.dev/plugin/dossardplus) :
- Solo : couleur du texte, masquage, trigramme personnalisé
- Multijoueur : trigramme seulement (couleur/chiffres gérés par le serveur)

### C. Plugins OpenPlanet « speedometer »
Le plugin [Speedometer](https://openplanet.dev/plugin/speedometer) (Greep / Ezio) affiche un **tableau de bord à l'écran** (vitesse, RPM, rapport) — ce n'est pas le panneau arrière natif.
Le plugin [Diegetic Information Display (DID)](https://openplanet.dev/plugin/did) affiche du texte **relatif à la voiture** (dont la vitesse) avec couleurs configurables par « lane ».

### D. Skins custom qui « cassent » l'affichage
Plusieurs rapports indiquent un **panneau arrière noir** ou des chiffres figés avec certains skins / réglages graphiques :
- [Dev Tracker — speedometer not working](https://devtrackers.gg/trackmania/p/698372b5-car-lights-speedometer-not-working)
- [Dev Tracker — no speedometer on back](https://devtrackers.gg/trackmania/p/07686aad-why-there-is-no-speedometer-on-back-of-my-car) — contournement : **qualité des textures** dans les options graphiques ; bug AMD « oversized graphics »

Un skin mal exporté (surtout `Details_I` / illumination) peut empêcher les **feux** de fonctionner correctement, mais cela ne donne pas le contrôle de la **couleur des chiffres de vitesse**.

---

## 4. Comment gérer couleur et affichage (hors skin)

### Affichage natif cassé ou absent
1. Options graphiques → augmenter la **qualité des textures**
2. Tester avec un skin officiel Nadeo
3. Vérifier l'intégrité des fichiers du jeu (Ubisoft Connect)
4. Mettre à jour les pilotes GPU (surtout AMD)

### Masquer / choisir les éléments HUD natifs
- Plugin OpenPlanet **[HUD Picker](https://openplanet.dev/plugin/hudpicker)** — sélection des éléments UI en course (ne fonctionne pas si « masquer l'interface » est actif)
- Créateurs de maps / modes : API `CModulePlaygroundSpeedMeter` pour visibilité et échelle

### Remplacer ou styliser l'affichage de vitesse
| Besoin | Solution |
|--------|----------|
| Compteur à l'écran (thèmes, couleurs) | [Speedometer](https://openplanet.dev/plugin/speedometer) — thèmes personnalisables (NanoVG) |
| Texte collé à la voiture (couleurs par lane) | [Diegetic Information Display](https://openplanet.dev/plugin/did) |
| Masquer le dossard | [DossardPlus](https://openplanet.dev/plugin/dossardplus) |
| Comparer vitesse aux splits PB | [SplitSpeeds](https://openplanet.dev/plugin/splitspeeds) |

Installation OpenPlanet : [openplanet.dev](https://openplanet.dev/) — nécessite l'édition Club pour TM2020.

---

## 5. Impact sur TM Skin Studio

### Ce que l'app gère déjà (pertinent mais distinct)
- `Skin_B` + générateur `raceNumber` → numéro **décoratif** peint sur la carrosserie
- `Details_I` → néons / phares / feux de frein (rôles alpha : always / head / brake)
- `CarPreview.ts` → matériaux `Skin_01`, `Details_01`, `Wheels_01`, `Glass_01`

### Ce que l'app ne doit pas promettre
- Changer la couleur des chiffres de vitesse à l'arrière
- Afficher/masquer le compteur natif via l'export ZIP
- Prévisualiser le compteur dynamique dans l'aperçu Three.js (données gameplay absentes)

### Amélioration UX possible (hors scope texture vitesse)
Ajouter une section d'aide / FAQ dans l'UI (texte statique) pointant vers ce document et les plugins OpenPlanet — **sans** nouvelle `MapDef`.

---

## 6. Pas de plan d'implémentation texture

**Aucune map DDS** ne contrôle les chiffres de vitesse. Il ne faut **pas** ajouter de `MapId` fictif dans `maps.ts`.

Maps Glass (`Glass_D`, `Glass_I`) pourraient un jour être ajoutées pour la teinte du verre, mais cela n'affectera toujours pas les chiffres de vitesse gameplay.

---

## Références

1. [Nadeo — Stadium CAR Resources (Dev Tracker)](https://devtrackers.gg/trackmania/p/3490d99c-stadium-car-ressources-all-you-need-to-create-skins-for-the-stadium-cars)
2. [ManiaScript — CModulePlaygroundSpeedMeter](https://maniascript.boss-bravo.fr/class_c_module_playground_speed_meter.html)
3. [OpenPlanet — Speedometer](https://openplanet.dev/plugin/speedometer)
4. [OpenPlanet — Diegetic Information Display](https://openplanet.dev/plugin/did)
5. [OpenPlanet — DossardPlus](https://openplanet.dev/plugin/dossardplus)
6. [OpenPlanet — HUD Picker](https://openplanet.dev/plugin/hudpicker)
7. [Dev Tracker — speedometer blacked out](https://devtrackers.gg/trackmania/p/698372b5-car-lights-speedometer-not-working)
8. [Dev Tracker — missing rear speedometer](https://devtrackers.gg/trackmania/p/07686aad-why-there-is-no-speedometer-on-back-of-my-car)
9. [Maniaplanet doc — custom lights (Details_I)](https://doc.maniaplanet.com/nadeo-importer/how-to-set-up-custom-lights)
