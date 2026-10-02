import { decodeSurfaceMaterial, encodeScalarMap, encodeSurfaceMaterial, SURFACE_PRESETS } from '../src/material';

let failures = 0;
const check = (name: string, result: boolean) => {
  if (!result) failures++;
  console.log(`${result ? 'ok' : 'FAIL'} ${name}`);
};

check('R/G encodent rugosité et métal, B reste nul', encodeSurfaceMaterial({ roughness: 90, metalness: 60 }) === '#5a3c00');
check('décodage exact des canaux', JSON.stringify(decodeSurfaceMaterial('#5a3c00')) === JSON.stringify({ roughness: 90, metalness: 60 }));
check('décodage d’une peinture translucide', JSON.stringify(decodeSurfaceMaterial('rgba(90,60,0,0.4)')) === JSON.stringify({ roughness: 90, metalness: 60 }));
check('bornes négatives', encodeSurfaceMaterial({ roughness: -20, metalness: -1 }) === '#000000');
check('bornes supérieures et arrondi', encodeSurfaceMaterial({ roughness: 280.6, metalness: 254.7 }) === '#ffff00');
check('nombres non finis', encodeSurfaceMaterial({ roughness: NaN, metalness: Infinity }) === '#000000');
check('cartes de vernis/saleté restent en gris', encodeScalarMap(127.6) === '#808080');
check('valeur invalide revient à peinture non métallique', decodeSurfaceMaterial('not-a-color').roughness === 0 && decodeSurfaceMaterial('not-a-color').metalness === 0);
check('presets exposent les 4 finitions accessibles', SURFACE_PRESETS.map((preset) => preset.label).join(',') === 'Peinture,Mat,Métallisé,Chrome');

if (failures) process.exit(1);
console.log('Tous les tests matière passent.');
