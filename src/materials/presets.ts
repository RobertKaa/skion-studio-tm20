import { createMaterialDefinition, type MaterialDefinition, type MaterialPreset } from './types';

export const MATERIAL_PRESETS: readonly { id: MaterialPreset; label: string; hint: string; definition: MaterialDefinition }[] = [
  { id: 'solid', label: 'Peinture satinée', hint: 'Une couleur et une finition à personnaliser.', definition: createMaterialDefinition('solid') },
  { id: 'carbon', label: 'Carbone', hint: 'Un tissage sombre sous un vernis brillant.', definition: createMaterialDefinition('carbon') },
  { id: 'brushed', label: 'Métal brossé', hint: 'Des stries fines qui suivent votre orientation.', definition: createMaterialDefinition('brushed') },
  { id: 'rubber', label: 'Caoutchouc', hint: 'Une surface sombre, mate et légèrement granuleuse.', definition: createMaterialDefinition('rubber') },
  { id: 'fabric', label: 'Tissu', hint: 'Une trame souple avec une finition mate.', definition: createMaterialDefinition('fabric') },
  { id: 'scratched', label: 'Peinture usée', hint: 'Des marques discrètes et une rugosité irrégulière.', definition: createMaterialDefinition('scratched') },
];
