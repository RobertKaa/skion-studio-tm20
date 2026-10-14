import type { EditorCore, LayerInfo } from '../editor/EditorCore';

export type LayerInspector = 'materials' | 'props' | 'layers';
type LayerEditor = Pick<EditorCore, 'selectLayer' | 'getSelectionMaterialLayer'>;

/** Resolve the owner before choosing its editor: a generated finish may switch maps. */
export function selectLayerInspector(editor: LayerEditor, layer: LayerInfo, edit = false): LayerInspector {
  if (layer.locked) return 'layers';
  editor.selectLayer(layer.id);
  if (editor.getSelectionMaterialLayer()) return 'materials';
  return edit || layer.linked ? 'props' : 'layers';
}

export function selectionInspector(editor: Pick<EditorCore, 'getSelectionMaterialLayer'>): 'materials' | 'props' {
  return editor.getSelectionMaterialLayer() ? 'materials' : 'props';
}
