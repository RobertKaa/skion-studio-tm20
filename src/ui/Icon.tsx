/**
 * Jeu d'icônes vectorielles (traits 24×24, style « lucide ») utilisé partout
 * dans l'interface à la place des emojis : rendu homogène, colorable via
 * `currentColor`, net à toutes les tailles.
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'select'
  | 'brush'
  | 'square'
  | 'circle'
  | 'line'
  | 'hexagon'
  | 'type'
  | 'image'
  | 'pipette'
  | 'flipH'
  | 'flipV'
  | 'grid'
  | 'guide'
  | 'undo'
  | 'redo'
  | 'trash'
  | 'eye'
  | 'eyeOff'
  | 'lock'
  | 'unlock'
  | 'chevronUp'
  | 'chevronDown'
  | 'chevronRight'
  | 'copy'
  | 'plus'
  | 'minus'
  | 'maximize'
  | 'x'
  | 'sparkles'
  | 'upload'
  | 'download'
  | 'layers'
  | 'sliders'
  | 'rotate'
  | 'crop'
  | 'box'
  | 'star'
  | 'droplet'
  | 'info'
  | 'panelRight'
  | 'target'
  | 'sun'
  | 'check'
  | 'more'
  | 'pen'
  | 'move'
  | 'save'
  | 'folder';

const PATHS: Record<IconName, string[]> = {
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2z', 'M7 3v6h10V3', 'M7 21v-8h10v8'],
  folder: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'],
  select: ['M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z', 'M13 13l6 6'],
  brush: [
    'M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08',
    'M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z',
  ],
  square: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'],
  circle: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18'],
  line: ['M5 19L19 5'],
  hexagon: [
    'M21 16.5a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16.5v-9a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 7.5z',
  ],
  type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
  image: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M8.5 7a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
    'M21 15l-5-5L5 21',
  ],
  pipette: [
    'm2 22 1-1h3l9-9',
    'M3 21v-3l9-9',
    'm15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z',
  ],
  flipH: [
    'M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3',
    'M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3',
    'M12 20v2',
    'M12 14v2',
    'M12 8v2',
    'M12 2v2',
  ],
  flipV: [
    'M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3',
    'M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3',
    'M4 12h2',
    'M10 12h2',
    'M16 12h2',
    'M22 12h-2',
  ],
  grid: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M3 9h18',
    'M3 15h18',
    'M9 3v18',
    'M15 3v18',
  ],
  guide: [
    'M3 7V5a2 2 0 0 1 2-2h2',
    'M17 3h2a2 2 0 0 1 2 2v2',
    'M21 17v2a2 2 0 0 1-2 2h-2',
    'M7 21H5a2 2 0 0 1-2-2v-2',
    'M8 12h8',
    'M12 8v8',
  ],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
  redo: ['M21 7v6h-6', 'M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'],
  trash: [
    'M3 6h18',
    'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6',
    'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2',
  ],
  eye: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
  eyeOff: [
    'M9.88 9.88a3 3 0 1 0 4.24 4.24',
    'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68',
    'M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61',
    'M2 2l20 20',
  ],
  lock: [
    'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
    'M7 11V7a5 5 0 0 1 10 0v4',
  ],
  unlock: [
    'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
    'M7 11V7a5 5 0 0 1 9.9-1',
  ],
  chevronUp: ['m18 15-6-6-6 6'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronRight: ['m9 18 6-6-6-6'],
  copy: [
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  maximize: [
    'M8 3H5a2 2 0 0 0-2 2v3',
    'M21 8V5a2 2 0 0 0-2-2h-3',
    'M3 16v3a2 2 0 0 0 2 2h3',
    'M16 21h3a2 2 0 0 0 2-2v-3',
  ],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  sparkles: [
    'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z',
    'M5 3v4',
    'M19 17v4',
    'M3 5h4',
    'M17 19h4',
  ],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  layers: [
    'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
    'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
    'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
  ],
  sliders: [
    'M4 21v-7',
    'M4 10V3',
    'M12 21v-9',
    'M12 8V3',
    'M20 21v-5',
    'M20 12V3',
    'M2 14h4',
    'M10 8h4',
    'M18 16h4',
  ],
  rotate: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  crop: ['M6 2v14a2 2 0 0 0 2 2h14', 'M18 22V8a2 2 0 0 0-2-2H2'],
  box: [
    'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
    'm3.3 7 8.7 5 8.7-5',
    'M12 22V12',
  ],
  star: [
    'm12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  ],
  droplet: [
    'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
  ],
  info: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M12 16v-4', 'M12 8h.01'],
  panelRight: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M15 3v18'],
  target: [
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18',
    'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10',
    'M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2',
  ],
  sun: [
    'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  check: ['M20 6 9 17l-5-5'],
  more: ['M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2', 'M19 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2', 'M5 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2'],
  pen: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
  move: ['M5 9l-3 3 3 3', 'M9 5l3-3 3 3', 'M15 19l-3 3-3-3', 'M19 9l3 3-3 3', 'M2 12h20', 'M12 2v20'],
};

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, strokeWidth = 1.75, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export default Icon;
