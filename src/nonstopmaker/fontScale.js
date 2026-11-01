/**
 * Font size preferences for the app.
 *
 * Two layers work together:
 * 1. The stylesheet uses rem-based tokens, so the base text is readable and
 *    still follows the browser's own default font size.
 * 2. These presets multiply every token through the `--nsm-font-scale`
 *    custom property, and the choice is remembered between sessions.
 */

export const FONT_SCALE_STORAGE_KEY = 'nonstopmaker.fontScale';

export const FONT_SCALES = [
  { id: 'small', label: 'Nhỏ', scale: 0.9, hint: '90%' },
  { id: 'medium', label: 'Vừa', scale: 1, hint: '100%' },
  { id: 'large', label: 'Lớn', scale: 1.15, hint: '115%' },
  { id: 'xlarge', label: 'Rất lớn', scale: 1.3, hint: '130%' },
];

export const DEFAULT_FONT_SCALE_ID = 'medium';

export function getFontScale(id) {
  return FONT_SCALES.find((level) => level.id === id) || FONT_SCALES.find((level) => level.id === DEFAULT_FONT_SCALE_ID);
}

export function fontScaleIndex(id) {
  const index = FONT_SCALES.findIndex((level) => level.id === id);
  return index === -1 ? FONT_SCALES.findIndex((level) => level.id === DEFAULT_FONT_SCALE_ID) : index;
}

/** Moves one step up or down in the preset list, clamped at both ends. */
export function stepFontScale(currentId, direction) {
  const index = fontScaleIndex(currentId);
  const next = Math.max(0, Math.min(FONT_SCALES.length - 1, index + Number(direction || 0)));
  return FONT_SCALES[next].id;
}

export function canDecreaseFontScale(id) {
  return fontScaleIndex(id) > 0;
}

export function canIncreaseFontScale(id) {
  return fontScaleIndex(id) < FONT_SCALES.length - 1;
}

/** Reads a saved preference. Any broken or hostile storage value falls back safely. */
export function readFontScale(storage) {
  try {
    const saved = storage?.getItem?.(FONT_SCALE_STORAGE_KEY);
    if (!saved) return DEFAULT_FONT_SCALE_ID;
    return getFontScale(saved).id;
  } catch {
    return DEFAULT_FONT_SCALE_ID;
  }
}

/** Persists the preference. Storage can be unavailable in private mode, so never throw. */
export function writeFontScale(storage, id) {
  try {
    storage?.setItem?.(FONT_SCALE_STORAGE_KEY, getFontScale(id).id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies the scale to the document so every rem token follows along.
 * Setting a custom property keeps a single source of truth in CSS.
 */
export function applyFontScale(documentElement, id) {
  const level = getFontScale(id);
  if (!documentElement?.style) return level;
  documentElement.style.setProperty('--nsm-font-scale', String(level.scale));
  documentElement.setAttribute?.('data-font-scale', level.id);
  return level;
}
