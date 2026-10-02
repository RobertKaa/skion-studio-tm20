import { FabricObject, Group } from 'fabric';

/** Groups do not inherit paint in Fabric: only their visible leaves carry it. */
export function paintLeaves(object: FabricObject): FabricObject[] {
  return object instanceof Group ? object.getObjects().flatMap(paintLeaves) : [object];
}

const paintChannel = (object: FabricObject) =>
  object.type === 'line' || object.type === 'path' ? 'stroke' : 'fill';

export function readObjectPaint(object: FabricObject) {
  const colors = paintLeaves(object)
    .filter((leaf) => leaf.type !== 'image')
    .map((leaf) => leaf[paintChannel(leaf)])
    .filter((color): color is string => typeof color === 'string');
  return {
    color: colors[0] ?? '#000000',
    mixed: colors.some((color) => color !== colors[0]),
    editable: colors.length > 0,
  };
}

/** Applies paint recursively and invalidates every ancestor's render cache. */
export function applyObjectPaint(object: FabricObject, color: string) {
  if (object instanceof Group) {
    for (const child of object.getObjects()) applyObjectPaint(child, color);
    object.dirty = true;
  } else if (object.type !== 'image') {
    const channel = paintChannel(object);
    const current = object[channel];
    const alpha = typeof current === 'string' ? /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(current)?.[1] : null;
    const packed = Number.parseInt(color.slice(1), 16);
    const next = alpha == null ? color : `rgba(${packed >> 16},${(packed >> 8) & 255},${packed & 255},${alpha})`;
    object.set({ [channel]: next });
  }
}

/** A fill/contour edit on a group must reach its constituent polygons too. */
export function applyObjectStyle(object: FabricObject, props: Record<string, unknown>) {
  object.set(props);
  if (!(object instanceof Group)) return;
  const paintProps = Object.fromEntries(
    Object.entries(props).filter(([key]) => ['fill', 'stroke', 'strokeWidth', 'strokeDashArray'].includes(key)),
  );
  if (Object.keys(paintProps).length) {
    for (const child of object.getObjects()) applyObjectStyle(child, paintProps);
    object.dirty = true;
  }
}
