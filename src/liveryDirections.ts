/** Art direction only: stable theme IDs preserve saved generator preferences. */
export type LiveryId = 'endurance' | 'heritage' | 'touring' | 'rallyRaid' | 'trackday' | 'streetArt' | 'drift' | 'nightRun' | 'fantasy';
export interface LiveryPalette { name: string; colors: readonly [string, string, string]; inspiration: string }
const palette = (name: string, colors: LiveryPalette['colors'], inspiration: string): LiveryPalette => ({ name, colors, inspiration });
export const LIVERY_PALETTES: Record<LiveryId, readonly LiveryPalette[]> = {
  fantasy: [
    palette('Améthyste / cyan', ['#302453','#2cebdd','#de7fe8'], 'Création fantastique · cristal vivant et veines de lumière'),
    palette('Obsidienne / magma', ['#242332','#ff632c','#ffc54e'], 'Création fantastique · roche volcanique et magma'),
    palette('Glace / aurore', ['#dae4ec','#2cafdb','#7552c9'], 'Création fantastique · glace et aurore boréale'),
    palette('Émeraude / lumière dorée', ['#143c39','#93f056','#efc445'], 'Création fantastique · minéral extraterrestre'),
    palette('Nuit / ultraviolet', ['#17192f','#c047ef','#47a7f7'], 'Création fantastique · nébuleuse et circuits arcanes'),
  ],
  endurance: [
    palette('Bleu glacier / orange', ['#71bed7','#f87518','#f6f0db'], 'Gulf · GT40 et prototypes des 24 heures'),
    palette('Ivoire / bleu / rouge', ['#e8e6dc','#143660','#df2529'], 'Prototypes d’endurance · rubans tricolores'),
    palette('Bleu nuit / or', ['#172f55','#ebce86','#f1eee4'], 'Endurance des années 80 · panneaux contrastés'),
    palette('Rouge / ivoire', ['#9e1730','#ece9da','#d4ae58'], 'Prototypes modernes · identification de classe'),
    palette('Argent / rouge', ['#b5bec5','#c0192e','#202d39'], 'Endurance GT · métal et carbone'),
  ],
  heritage: [
    palette('Bleu rallye / or', ['#163fb0','#f2cd28','#f4f2e8'], 'Rallye années 90 · bleu, or et comètes'),
    palette('Blanc / vert / rouge', ['#efeee5','#087951','#d61f2d'], 'Celica ST185 · rubans verts et rouges'),
    palette('Ivoire / rouge / gris', ['#eeebe0','#c52425','#262b30'], 'Groupe B · blocs géométriques'),
    palette('Rouge / blanc', ['#c11e27','#f0eeea','#2d3038'], 'Rallye japonais · aplats et plaques de spéciale'),
    palette('Blanc / bleu / jaune', ['#eceee7','#17409a','#eac934'], 'Rallye européen · rubans de carrosserie'),
  ],
  touring: [
    palette('Papaye / carbone', ['#f77512','#192128','#e9edf0'], 'McLaren · papaye et carbone apparent'),
    palette('Rouge course / blanc', ['#c61726','#f2ede0','#252931'], 'Monoplaces italiennes · rouge et champs blancs'),
    palette('Argent / turquoise', ['#b9c2c6','#00bea9','#1b242b'], 'Monoplaces hybrides · argent et turquoise'),
    palette('Bleu nuit / jaune', ['#15264f','#f2c41b','#d82d36'], 'Monoplaces modernes · nez et ailerons contrastés'),
    palette('Vert anglais / citron', ['#12584e','#d8ed2d','#eef0db'], 'Grand Prix · laque verte et filets citron'),
  ],
  rallyRaid: [
    palette('Blanc / rouge / noir', ['#efeee6','#df2731','#20282d'], 'Rallye usine · découpes rouges et carbone'),
    palette('Bleu / rose / blanc', ['#154e8c','#ed275f','#ecefe7'], 'Rallye moderne · panneaux très contrastés'),
    palette('Blanc / bleu / rouge', ['#f0ede2','#153b92','#d32431'], 'Écuries de rallye · tricolore et sponsors'),
    palette('Orange / noir', ['#ec6e13','#242b31','#efede5'], 'Rallye terre · orange sécurité et protections'),
    palette('Gris / cyan / rouge', ['#9eb2be','#09b7d0','#d63231'], 'Rallye hybride · diagonales multicolores'),
  ],
  trackday: [
    palette('Bleu / jaune', ['#153f99','#ffcf16','#f8f0df'], 'NASCAR · capot sponsor et numéro détouré'),
    palette('Rouge / noir', ['#cd2027','#1e2329','#f2f0e9'], 'Stock-car · carrosserie rouge et flancs noirs'),
    palette('Noir / vert électrique', ['#20282c','#8fe022','#f6f0de'], 'Stock-car · couleurs de sponsor à fort contraste'),
    palette('Orange / bleu', ['#ed6418','#154988','#f7eee0'], 'Stock-car · panneaux orange et bleus'),
    palette('Blanc / violet', ['#eaece8','#5e287e','#ef8d1a'], 'Stock-car · identité de sponsor tricolore'),
  ],
  streetArt: [
    palette('Lime / violet / argent', ['#8bdb13','#433a97','#e4e8ec'], 'Tuning 2000 · grands tribaux et capot carbone'),
    palette('Orange candy / lime', ['#ef6b0b','#bad52c','#313743'], 'Tuning 2000 · vinyles illustrés sur peinture candy'),
    palette('Bleu électrique / argent', ['#1159b5','#e1e8e8','#172435'], 'Underground · tribaux argent et néons'),
    palette('Violet / turquoise', ['#652485','#29dcb8','#f0e8dc'], 'Tuning de salon · couleurs candy et vinyles'),
    palette('Jaune acide / noir', ['#dfed19','#292d37','#d0d5dc'], 'Tuning 2000 · grands motifs à pointes'),
  ],
  drift: [
    palette('Rouge candy / chrome', ['#c31930','#ccd7de','#262232'], 'Showcar 2000 · déchirures chromées'),
    palette('Bleu / or / chrome', ['#173ea4','#efb728','#e3e7e9'], 'Showcar de salon · peinture bicolore et chrome'),
    palette('Orange / violet', ['#ec6b0b','#573389','#e4e7ec'], 'Underground · flammes et vernis candy'),
    palette('Violet / argent', ['#852788','#dae3e6','#30d9d8'], 'Showcar nocturne · vinyles métalliques et néons'),
    palette('Vert / bleu nuit', ['#80d717','#193987','#eef0ea'], 'Tuning 2000 · flancs sculptés par les vinyles'),
  ],
  nightRun: [
    palette('Argent / rouge / noir', ['#b7c2ce','#d62631','#19232b'], 'Skyline de préparateur · bandes rouges et noires'),
    palette('Orange / carbone', ['#dc6511','#dedddd','#232a32'], 'GT-R préparée · orange métallisé et carbone'),
    palette('Blanc / rouge / noir', ['#e8e9e4','#bc202c','#20242e'], 'Atelier japonais · vinyles techniques et capot carbone'),
    palette('Noir / lime', ['#232a30','#a9e221','#d6dfe2'], 'Préparation turbo · accents acides et composite'),
    palette('Bleu / blanc', ['#164ba8','#ecede6','#292b36'], 'Street performance · bleu laqué et bandes blanches'),
  ],
};
export const LIVERY_COMPOSITIONS: Record<LiveryId, readonly [string, string, string]> = {
  fantasy: ['Cristal astral', 'Nébuleuse', 'Circuit arcanique'],
  endurance: ['Bande centrale', 'Doubles bandes', 'Bande décentrée'],
  heritage: ['Comètes rallye', 'Rubans entrelacés', 'Blocs Groupe B'],
  touring: ['Flancs carbone', 'Panneaux Grand Prix', 'Flèche de vitesse'],
  rallyRaid: ['Diagonales usine', 'Rubans de spéciale', 'Panneaux de rallye'],
  trackday: ['Éclairs stock-car', 'Flammes de speedway', 'Panneaux sponsor'],
  streetArt: ['Tribal à pointes', 'Dragon mécanique', 'Lames entrelacées'],
  drift: ['Déchirures chrome', 'Flammes candy', 'Vagues de salon'],
  nightRun: ['Double bande décentrée', 'Griffures de préparateur', 'Éclairs street'],
};
