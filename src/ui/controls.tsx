/**
 * Petits composants de formulaire partagés par l'interface : pastille de
 * couleur, curseur avec valeur, bouton icône avec infobulle, section de
 * l'inspecteur. Volontairement sans dépendance externe.
 */
import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Pastille de couleur : un `<input type=color>` natif rendu invisible par-dessus. */
export function Swatch({
  value,
  onChange,
  disabled,
  title,
  size = 'md',
  showHex = false,
}: {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  title?: string;
  size?: 'sm' | 'md';
  showHex?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const channels = /^rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/i.exec(value);
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : channels ? `#${channels.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')}` : '#000000';
  const swatch = (
    <label className={`swatch swatch--${size}${disabled ? ' swatch--disabled' : ''}`} title={title} style={{ ['--swatch' as string]: value }}>
      <input type="color" aria-label={title ?? 'Choisir une couleur'} value={hex} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
  if (!showHex) return swatch;
  return (
    <span className="color-field">
      {swatch}
      <input className="color-hex" aria-label={`Code couleur · ${title ?? 'peinture'}`} value={draft ?? hex.toUpperCase()} disabled={disabled} spellCheck={false} maxLength={7}
        onFocus={() => setDraft(hex.toUpperCase())}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (/^#?[0-9a-f]{6}$/i.test(next)) onChange(`#${next.replace('#', '').toLowerCase()}`);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
        }} />
    </span>
  );
}

/**
 * Curseur horizontal avec libellé et valeur affichée.
 * `onCommit` est appelé à la fin d'un geste (relâchement du pointeur, touche
 * relâchée, perte du focus) — utile pour clore une entrée d'historique fusionnée.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  onCommit,
  disabled,
  title,
  compact,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
  title?: string;
  compact?: boolean;
}) {
  return (
    <label className={`slider${compact ? ' slider--compact' : ''}`} title={title}>
      <span className="slider-label">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      <span className="slider-value">{format ? format(value) : value}</span>
    </label>
  );
}

/** Bouton icône carré avec infobulle (libellé + raccourci). */
export function IconButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  danger,
  onClick,
  tipSide = 'bottom',
  size = 'md',
  className = '',
}: {
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
  tipSide?: 'right' | 'bottom' | 'left' | 'top';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`iconbtn iconbtn--${size}${active ? ' is-active' : ''}${
        danger ? ' is-danger' : ''
      } ${className}`}
      data-tip={shortcut ? `${label} · ${shortcut}` : label}
      data-tip-side={tipSide}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={size === 'lg' ? 18 : size === 'sm' ? 14 : 16} />
    </button>
  );
}

/** Bloc titré de l'inspecteur, repliable si `collapsible`. */
export function Section({
  title,
  children,
  actions,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  if (collapsible) {
    return (
      <details className="section section--collapsible" open={defaultOpen}>
        <summary className="section-head">
          <Icon name="chevronRight" size={12} className="section-chevron" />
          <span className="section-title">{title}</span>
          {actions && <span className="section-actions">{actions}</span>}
        </summary>
        <div className="section-body">{children}</div>
      </details>
    );
  }
  return (
    <section className="section">
      <div className="section-head">
        <span className="section-title">{title}</span>
        {actions && <span className="section-actions">{actions}</span>}
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}

/** Ligne « libellé : contrôle » d'un formulaire de l'inspecteur. */
export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="row" title={hint}>
      <span className="row-label">{label}</span>
      <div className="row-control">{children}</div>
    </div>
  );
}

/** Interrupteur (checkbox stylisée). */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span className="toggle-label">{label}</span>
    </label>
  );
}
