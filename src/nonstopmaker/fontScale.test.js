import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFontScale,
  canDecreaseFontScale,
  canIncreaseFontScale,
  DEFAULT_FONT_SCALE_ID,
  FONT_SCALE_STORAGE_KEY,
  FONT_SCALES,
  fontScaleIndex,
  getFontScale,
  readFontScale,
  stepFontScale,
  writeFontScale,
} from './fontScale.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    data,
  };
}

function fakeElement() {
  const props = {};
  return {
    style: { setProperty: (key, value) => { props[key] = value; }, getPropertyValue: (key) => props[key] },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    props,
  };
}

test('four presets are offered from smallest to largest', () => {
  assert.equal(FONT_SCALES.length, 4);
  assert.deepEqual(FONT_SCALES.map((level) => level.id), ['small', 'medium', 'large', 'xlarge']);
  const scales = FONT_SCALES.map((level) => level.scale);
  assert.deepEqual(scales, [...scales].sort((a, b) => a - b), 'presets must be ordered');
  assert.equal(FONT_SCALES.find((level) => level.id === 'medium').scale, 1, 'default must be 100%');
});

test('getFontScale falls back to the default for unknown ids', () => {
  assert.equal(getFontScale('large').id, 'large');
  assert.equal(getFontScale('nope').id, DEFAULT_FONT_SCALE_ID);
  assert.equal(getFontScale(undefined).id, DEFAULT_FONT_SCALE_ID);
  assert.equal(getFontScale(null).id, DEFAULT_FONT_SCALE_ID);
});

test('fontScaleIndex is stable and defaults safely', () => {
  assert.equal(fontScaleIndex('small'), 0);
  assert.equal(fontScaleIndex('xlarge'), 3);
  assert.equal(fontScaleIndex('garbage'), 1);
});

test('stepFontScale walks the list and clamps at the ends', () => {
  assert.equal(stepFontScale('medium', 1), 'large');
  assert.equal(stepFontScale('large', -1), 'medium');
  assert.equal(stepFontScale('small', -1), 'small', 'cannot go below the smallest');
  assert.equal(stepFontScale('xlarge', 1), 'xlarge', 'cannot go above the largest');
  assert.equal(stepFontScale('unknown', 1), 'large');
  assert.equal(stepFontScale('medium', 0), 'medium');
  assert.equal(stepFontScale('medium', undefined), 'medium');
});

test('canIncrease / canDecrease report the boundaries correctly', () => {
  assert.equal(canDecreaseFontScale('small'), false);
  assert.equal(canDecreaseFontScale('medium'), true);
  assert.equal(canIncreaseFontScale('xlarge'), false);
  assert.equal(canIncreaseFontScale('large'), true);
});

test('readFontScale returns a saved preset', () => {
  const storage = fakeStorage({ [FONT_SCALE_STORAGE_KEY]: 'xlarge' });
  assert.equal(readFontScale(storage), 'xlarge');
});

test('readFontScale ignores empty, corrupt or unknown values', () => {
  assert.equal(readFontScale(fakeStorage()), DEFAULT_FONT_SCALE_ID);
  assert.equal(readFontScale(fakeStorage({ [FONT_SCALE_STORAGE_KEY]: '' })), DEFAULT_FONT_SCALE_ID);
  assert.equal(readFontScale(fakeStorage({ [FONT_SCALE_STORAGE_KEY]: '{"json":true}' })), DEFAULT_FONT_SCALE_ID);
  assert.equal(readFontScale(fakeStorage({ [FONT_SCALE_STORAGE_KEY]: '99999' })), DEFAULT_FONT_SCALE_ID);
  assert.equal(readFontScale(undefined), DEFAULT_FONT_SCALE_ID);
});

test('readFontScale survives storage that throws (private mode)', () => {
  const storage = { getItem() { throw new Error('denied'); } };
  assert.equal(readFontScale(storage), DEFAULT_FONT_SCALE_ID);
});

test('writeFontScale persists a valid id and reports failure without throwing', () => {
  const storage = fakeStorage();
  assert.equal(writeFontScale(storage, 'large'), true);
  assert.equal(storage.data[FONT_SCALE_STORAGE_KEY], 'large');

  const throwing = { setItem() { throw new Error('quota'); } };
  assert.equal(writeFontScale(throwing, 'large'), false);

  const storageUnknown = fakeStorage();
  writeFontScale(storageUnknown, 'gibberish');
  assert.equal(storageUnknown.data[FONT_SCALE_STORAGE_KEY], DEFAULT_FONT_SCALE_ID);
});

test('applyFontScale writes the scale custom property and data attribute', () => {
  const element = fakeElement();
  const level = applyFontScale(element, 'xlarge');
  assert.equal(level.id, 'xlarge');
  assert.equal(element.props['--nsm-font-scale'], '1.3');
  assert.equal(element.attributes['data-font-scale'], 'xlarge');
});

test('applyFontScale defaults safely when the element is missing', () => {
  const level = applyFontScale(null, 'large');
  assert.equal(level.id, 'large', 'still reports the requested level');
  assert.equal(applyFontScale(null, 'bogus').id, DEFAULT_FONT_SCALE_ID);
});
