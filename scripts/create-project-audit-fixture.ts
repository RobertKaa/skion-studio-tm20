import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { MAPS } from '../src/maps';
import { writeProjectFile, type ProjectDocument } from '../src/projectFile';

// Jeu de données reproductible pour l'import par le sélecteur de la page ouverte.
const document: ProjectDocument = { format: 'tm-skin-studio', version: 1, name: 'Audit fichier portable',
  editor: { maps: Object.fromEntries(MAPS.map((map) => [map.id, { version: '7.4.0', objects: [], background: map.defaultFill }])) as ProjectDocument['editor']['maps'], speedColor: '#ff22aa', illumRole: 'brake' },
  workspace: { activeMap: 'Wheels_B', view: 'split', camera: { position: [3, 2, 4], target: [0, .5, 0] }, coatIntensity: .7, neonIntensity: 2.1, night: true, braking: true }, model: null };
document.editor.maps.Wheels_B.objects = [
  { type: 'Image', id: 'audit-uv-image', name: 'Image UV autonome', src: 'assets/image-0.png', left: 250, top: 260, width: 1280, height: 840, scaleX: .18, scaleY: .18, angle: 27, opacity: .8, visible: true, imageMaterialEnabled: true, imageMaterial: { roughness: 235, metalness: 0 }, imageOrder: 1 },
  { type: 'Rect', id: 'audit-rectangle', name: 'Rectangle indépendant', left: 90, top: 110, width: 100, height: 60, angle: 13, fill: '#00ffaa' },
  { type: 'IText', id: 'audit-text', name: 'Texte éditable', text: 'SKIN', left: 120, top: 180, fontSize: 30, fill: '#ffffff' },
];
document.editor.maps.Details_I.objects = [{ type: 'Rect', id: 'audit-light', name: 'Feu éditable', left: 440, top: 430, width: 80, height: 30, fill: '#00ffff', illumRole: 'head' }];
const assets = new Map([['assets/image-0.png', new Uint8Array(await readFile('audit-evidence/toit-mat.png'))]]);
await writeFile('audit-evidence/project-portable-fixture.tmskin', new Uint8Array(await (await writeProjectFile({ document, assets })).arrayBuffer()));
const invalid = new JSZip(); invalid.file('project.json', JSON.stringify({ ...document, version: 99 }));
await writeFile('audit-evidence/project-invalid-fixture.tmskin', await invalid.generateAsync({ type: 'nodebuffer' }));
console.log('Fichiers d’audit prêts : projet portable et version invalide.');
