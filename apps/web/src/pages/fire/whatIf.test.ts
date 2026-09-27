// The what-if model (stage-6.md §6.2, §6.4): the values in use, the query of only the changed fields
// (normalised decimals, never floats), the save patch and summary, parsing within the query bounds,
// the sliders' ranges (extended to the current value), snapping and keys, and server field errors.
import { FIRE_WHAT_IF_FIELDS, fireQuerySchema } from '@joinr/schema';
import { firePages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import {
  SLIDER_DEFAULTS,
  WHAT_IF_FIELDS,
  baseValues,
  changedFields,
  fieldErrorsOf,
  fromSlider,
  inputText,
  parseField,
  percentInput,
  queryKeyText,
  savePatch,
  saveSummary,
  sliderKeyValue,
  sliderRange,
  sliderValue,
  sliderValueText,
  snapToStep,
  valueWords,
  whatIfQuery,
  type WhatIfBase,
} from './whatIf';

const onTrackBase = baseValues(firePages.onTrack.inputs);

describe('baseValues: the value each field starts at', () => {
  it('reads the saved setting, else the derived figure, else the default', () => {
    expect(onTrackBase).toEqual({
      spend: 4_000_000,
      withdrawalRate: '0.05',
      inflationRate: '0.02',
      marketReturn: '0.0612',
      accessAge: 60,
      extraSavings: 0,
    });
    // A saved spend override wins over the derived figure.
    expect(baseValues(firePages.spendOverride.inputs).spend).toBe(
      firePages.spendOverride.inputs.yearlySpend.savedCents,
    );
    // Nothing to base a spend on; the access age defaults to 60.
    const empty = baseValues(firePages.empty.inputs);
    expect(empty.spend).toBeNull();
    expect(empty.withdrawalRate).toBeNull();
    expect(empty.accessAge).toBe(60);
  });

  it('is the same for a what-if response (the saved and derived parts, not the value in use)', () => {
    const whatIf = baseValues(firePages.whatIf.inputs);
    expect(firePages.whatIf.inputs.yearlySpend.cents).toBe(5_000_000);
    expect(whatIf.spend).toBe(4_000_000);
  });
});

describe('the query and the save', () => {
  it('holds only the fields that differ from the saved values', () => {
    expect(whatIfQuery({}, onTrackBase)).toBeNull();
    // Equal values (a ratio compared as a normalised decimal) send nothing.
    expect(
      whatIfQuery({ spend: 4_000_000, withdrawalRate: '0.050', accessAge: 60 }, onTrackBase),
    ).toBeNull();
    const query = whatIfQuery(
      { spend: 4_250_000, withdrawalRate: '0.045', accessAge: 60, extraSavings: -100_000 },
      onTrackBase,
    );
    expect(query).toEqual({ spend: 4_250_000, withdrawalRate: '0.045', extraSavings: -100_000 });
    // The query the server accepts.
    expect(fireQuerySchema.parse(query)).toEqual(query);
    expect(changedFields({ inflationRate: '0.03', marketReturn: '0.0612' }, onTrackBase)).toEqual([
      'inflationRate',
    ]);
  });

  it('sends a field whose saved value is unset', () => {
    const base = baseValues(firePages.spendNeeded.inputs);
    expect(whatIfQuery({ spend: 4_000_000 }, base)).toEqual({ spend: 4_000_000 });
  });

  it('tells two queries apart by content, whatever their key order', () => {
    expect(queryKeyText(null)).toBe('');
    expect(queryKeyText({ spend: 1, accessAge: 62 })).toBe(
      queryKeyText({ accessAge: 62, spend: 1 }),
    );
    expect(queryKeyText({ spend: 1 })).not.toBe(queryKeyText({ spend: 2 }));
  });

  it('saves the changed fields under their setting keys', () => {
    expect(savePatch({}, onTrackBase)).toBeNull();
    expect(
      savePatch(
        { spend: 4_200_000, accessAge: 62, marketReturn: '0.065', withdrawalRate: '0.05' },
        onTrackBase,
      ),
    ).toEqual({
      values: {
        [FIRE_WHAT_IF_FIELDS.spend]: 4_200_000,
        [FIRE_WHAT_IF_FIELDS.marketReturn]: '0.065',
        [FIRE_WHAT_IF_FIELDS.accessAge]: 62,
      },
    });
  });

  it('summarises what Save writes', () => {
    expect(saveSummary({}, onTrackBase)).toBeNull();
    expect(saveSummary({ spend: 4_200_000, accessAge: 62 }, onTrackBase)).toBe(
      'Saves: yearly spend $42,000 · access age 62',
    );
    expect(saveSummary({ withdrawalRate: '0.045', extraSavings: -500_000 }, onTrackBase)).toBe(
      'Saves: withdrawal rate 4.5% · extra savings a year −$5,000',
    );
  });
});

describe('display and parsing', () => {
  it('shows a rate at its stored precision up to 2 dp, as a percentage', () => {
    expect(percentInput('0.0375')).toBe('3.75');
    expect(percentInput('0.05')).toBe('5');
    expect(percentInput('0.0612')).toBe('6.12');
    expect(percentInput('-0.005')).toBe('−0.5');
    expect(inputText('withdrawalRate', '0.0375')).toBe('3.75');
    expect(inputText('spend', 4_123_700)).toBe('41,237');
    expect(inputText('spend', 4_123_750)).toBe('41,237.50');
    expect(inputText('extraSavings', -500_000)).toBe('−5,000');
    expect(inputText('accessAge', 60)).toBe('60');
    expect(inputText('spend', null)).toBe('');
  });

  it('parses each field within the query bounds', () => {
    expect(parseField('spend', '')).toBeNull();
    expect(parseField('spend', '42,500')).toEqual({ ok: true, value: 4_250_000 });
    expect(parseField('spend', '$42500.5')).toEqual({ ok: true, value: 4_250_050 });
    expect(parseField('spend', '-1')).toMatchObject({ ok: false });
    expect(parseField('extraSavings', '−5,000')).toEqual({ ok: true, value: -500_000 });
    expect(parseField('extraSavings', '20000000')).toMatchObject({ ok: false });
    expect(parseField('withdrawalRate', '3.75')).toEqual({ ok: true, value: '0.0375' });
    expect(parseField('withdrawalRate', '0')).toMatchObject({ ok: false });
    expect(parseField('withdrawalRate', '3.755')).toMatchObject({ ok: false });
    expect(parseField('inflationRate', '-0.5')).toEqual({ ok: true, value: '-0.005' });
    expect(parseField('inflationRate', '-100')).toMatchObject({ ok: false });
    expect(parseField('marketReturn', '101')).toMatchObject({ ok: false });
    expect(parseField('marketReturn', 'abc')).toMatchObject({ ok: false });
    expect(parseField('accessAge', '62')).toEqual({ ok: true, value: 62 });
    expect(parseField('accessAge', '29')).toMatchObject({ ok: false });
    expect(parseField('accessAge', '101')).toMatchObject({ ok: false });
    expect(parseField('accessAge', '60.5')).toMatchObject({ ok: false });
  });

  it('words values in the §8 formats', () => {
    expect(valueWords('spend', 4_250_000)).toBe('$42,500');
    expect(valueWords('withdrawalRate', '0.0375')).toBe('3.8%');
    expect(valueWords('accessAge', 60)).toBe('age 60');
    expect(valueWords('spend', null)).toBe('not set');
    expect(sliderValueText('spend', 4_250_000)).toBe('$42,500 a year');
    expect(sliderValueText('extraSavings', -500_000)).toBe('−$5,000 a year');
    expect(sliderValueText('withdrawalRate', '0.04')).toBe('4.0%');
    expect(sliderValueText('accessAge', 60)).toBe('age 60');
  });
});

describe('sliders', () => {
  it('convert between field values and slider units', () => {
    expect(sliderValue('spend', 4_250_000)).toBe(42_500);
    expect(sliderValue('withdrawalRate', '0.0375')).toBe(3.75);
    expect(sliderValue('accessAge', 60)).toBe(60);
    expect(fromSlider('spend', 42_500)).toBe(4_250_000);
    expect(fromSlider('withdrawalRate', 4.1)).toBe('0.041');
    // Float noise never reaches the ratio.
    expect(fromSlider('inflationRate', 0.1 + 0.2)).toBe('0.003');
    expect(fromSlider('accessAge', 62)).toBe(62);
  });

  it('use the planned default ranges', () => {
    expect(SLIDER_DEFAULTS).toEqual({
      spend: { min: 0, max: 200_000, step: 500 },
      withdrawalRate: { min: 2, max: 8, step: 0.1 },
      inflationRate: { min: 0, max: 8, step: 0.1 },
      marketReturn: { min: 0, max: 12, step: 0.1 },
      accessAge: { min: 55, max: 75, step: 1 },
      extraSavings: { min: -50_000, max: 100_000, step: 1_000 },
    });
    expect(WHAT_IF_FIELDS).toHaveLength(6);
  });

  it('extend on the step grid to include the current value', () => {
    expect(sliderRange('inflationRate', -0.5)).toEqual({ min: -0.5, max: 8, step: 0.1 });
    expect(sliderRange('accessAge', 50)).toEqual({ min: 50, max: 75, step: 1 });
    expect(sliderRange('withdrawalRate', 9)).toEqual({ min: 2, max: 9, step: 0.1 });
    expect(sliderRange('withdrawalRate', 1.25)).toEqual({ min: 1.2, max: 8, step: 0.1 });
    // The spend reaches twice the value in use (and at least $200,000).
    expect(sliderRange('spend', 150_000, 150_000)).toEqual({ min: 0, max: 300_000, step: 500 });
    expect(sliderRange('spend', 41_237, 41_237)).toEqual({ min: 0, max: 200_000, step: 500 });
    expect(sliderRange('spend', null, null)).toEqual({ min: 0, max: 200_000, step: 500 });
  });

  it('snap to the step and handle the keys explicitly', () => {
    const range = sliderRange('spend', 41_237, 41_237);
    expect(snapToStep(41_237, range)).toBe(41_000);
    expect(sliderKeyValue('ArrowRight', 41_237, range)).toBe(41_500);
    expect(sliderKeyValue('ArrowUp', 41_000, range)).toBe(41_500);
    expect(sliderKeyValue('ArrowLeft', 41_000, range)).toBe(40_500);
    expect(sliderKeyValue('ArrowDown', 0, range)).toBe(0);
    expect(sliderKeyValue('PageUp', 41_000, range)).toBe(46_000);
    expect(sliderKeyValue('PageDown', 41_000, range)).toBe(36_000);
    expect(sliderKeyValue('Home', 41_000, range)).toBe(0);
    expect(sliderKeyValue('End', 41_000, range)).toBe(200_000);
    expect(sliderKeyValue('Enter', 41_000, range)).toBeNull();
    const rate = sliderRange('withdrawalRate', 4);
    expect(sliderKeyValue('ArrowRight', 4, rate)).toBe(4.1);
    expect(sliderKeyValue('PageUp', 4, rate)).toBe(5);
    expect(sliderKeyValue('End', 4, rate)).toBe(8);
    expect(sliderKeyValue('ArrowLeft', null, rate)).toBe(2);
  });
});

describe('server field errors', () => {
  it('maps a VALIDATION_ERROR message to the fields it names', () => {
    expect(fieldErrorsOf('withdrawalRate: must be above 0; accessAge: Too big')).toEqual({
      withdrawalRate: 'Withdrawal rate must be above 0',
      accessAge: 'Access age Too big',
    });
    expect(fieldErrorsOf('values.fire.birthYear: must be at most 2100')).toBeNull();
    expect(fieldErrorsOf('Something failed')).toBeNull();
    expect(fieldErrorsOf('')).toBeNull();
  });
});

describe('types', () => {
  it('keeps the base record complete', () => {
    const keys = Object.keys(onTrackBase satisfies WhatIfBase).sort();
    expect(keys).toEqual([...WHAT_IF_FIELDS].sort());
  });
});
