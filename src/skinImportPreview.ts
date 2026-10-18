import type { Skin3DProject } from './skin3d';
import type { DetailsLayout } from './detailsSides';

interface ImportPreview {
  loadCustomPreview(buffer: ArrayBuffer, options?: { nativeSurfaceLayout?: boolean; detailsLayout?: DetailsLayout }): Promise<void>;
  loadOfficialModel(): Promise<void>;
}

/** Install the new preview before committing imported textures or project state. */
export async function loadSkinImportPreview(model: Skin3DProject | null, preview: ImportPreview): Promise<{
  model: Skin3DProject | null;
  warning: string | null;
}> {
  let warning: string | null = null;
  if (model?.preview) {
    try {
      await preview.loadCustomPreview(model.preview, { detailsLayout: model.detailsLayout, nativeSurfaceLayout: !!model.detailsLayout });
      return { model, warning };
    } catch (error) {
      warning = `Aperçu 3D illisible : ${error instanceof Error ? error.message : String(error)}.`;
    }
  }

  // A game GBX cannot be displayed by the browser. Never keep another skin's geometry.
  await preview.loadOfficialModel();
  if (!model) return { model: null, warning };

  const fallback: Skin3DProject = { ...model, preview: null };
  delete fallback.parts;
  return {
    model: fallback,
    warning: `${warning ? `${warning} ` : ''}Aperçu générique de la voiture officielle. Importez la version du skin pour l’app (…-app.zip ou skin3d-project.zip) pour afficher sa forme. Le modèle du jeu est conservé pour l’export.`,
  };
}
