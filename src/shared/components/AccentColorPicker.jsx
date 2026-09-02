import { faTimesCircle, faDroplet } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// Sentinel stored/passed in place of a hex color to mean "no accent tint,
// neutral frosted glass" (as opposed to null, which means "default dark
// glass background"). Still a fairly dark, blurred material, not literally
// see-through — see the .is-colorless CSS rule for why a lighter/see-through
// background reads unreadable over a busy wallpaper. Kept as a string so it
// survives the same localStorage round-trip as a hex value without a second
// storage key per caller.
export const TRANSPARENT_ACCENT = 'transparent';

// Shared accent palette used by the workspace card context menu and its detail
// panel. Vivid, high-contrast hues that tint safely over the dark glass base.
export const ACCENT_SWATCHES = [
  '#3B82F6', // blue
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#EF4444', // red
  '#F59E0B', // orange
  '#FCD34D', // gold
  '#10B981', // green
  '#14B8A6', // teal
  '#06B6D4', // cyan
];

const isHex6 = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');

/**
 * Reset + preset swatches + native custom-color picker.
 *
 * onSelect(color, source) — color is a hex string, null (reset), or
 * TRANSPARENT_ACCENT (colorless). `source` is 'reset' | 'preset' | 'custom' |
 * 'transparent' so callers can vary side effects (e.g. keep a context menu
 * open while the live picker is in use).
 *
 * `allowTransparent` adds a colorless swatch alongside the reset swatch, for
 * callers whose base surface has its own background/blur that the user might
 * want to strip entirely (see OverviewDashboard's column chips) rather than
 * just skip an accent tint on.
 */
export function AccentColorPicker({ value, onSelect, swatches = ACCENT_SWATCHES, className = '', allowTransparent = false }) {
  const isCustom = value && value !== TRANSPARENT_ACCENT && !swatches.includes(value);
  return (
    <div className={`accent-picker ${className}`.trim()}>
      <button
        type="button"
        className={`card-swatch card-swatch--reset ${!value ? 'is-active' : ''}`}
        onClick={() => onSelect(null, 'reset')}
        title="Default color"
        aria-label="Reset to default color"
      >
        <FontAwesomeIcon icon={faTimesCircle} />
      </button>
      {allowTransparent && (
        <button
          type="button"
          className={`card-swatch card-swatch--transparent ${value === TRANSPARENT_ACCENT ? 'is-active' : ''}`}
          onClick={() => onSelect(TRANSPARENT_ACCENT, 'transparent')}
          title="Colorless (frosted, no tint)"
          aria-label="Remove accent tint"
        >
          <FontAwesomeIcon icon={faDroplet} style={{ opacity: 0.35 }} />
        </button>
      )}
      {swatches.map((c) => (
        <button
          type="button"
          key={c}
          className={`card-swatch ${value === c ? 'is-active' : ''}`}
          style={{ '--swatch': c }}
          onClick={() => onSelect(c, 'preset')}
          title={c}
          aria-label={`Set color ${c}`}
        />
      ))}
      {/* Custom color — native picker, so users aren't limited to presets.
          Safe because the color only ever tints over the dark glass base. */}
      <label
        className={`card-swatch card-swatch--custom ${isCustom ? 'is-active' : ''}`}
        title="Custom color…"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="color"
          value={isHex6(value) ? value : '#3B82F6'}
          onChange={(e) => onSelect(e.target.value, 'custom')}
        />
      </label>
    </div>
  );
}
