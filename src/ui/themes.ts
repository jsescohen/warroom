import type { ThemeId } from '../core/types';

/** Colors the map renderer needs. CSS-only styling lives in styles.css under [data-theme]. */
export interface MapPalette {
  graticule: number;
  graticuleAlpha: number;
  shore: number;
  shoreAlpha: number;
  coast: number;
  nationBorder: number;
  provinceBorder: number;
  provinceBorderAlpha: number;
  landShadow: number;
  landShadowAlpha: number;
  /** Land that belongs to no one. */
  unclaimed: number;
  /** Nation colors are mixed toward this tone to match the era's look. */
  paper: string;
  paperMix: number;
  labelFill: string;
  labelStroke: string;
  provinceLabelFill: string;
  provinceLabelStroke: string;
  hover: number;
  selection: number;
  capital: number;
}

export interface Theme {
  id: ThemeId;
  displayFont: string;
  labelFont: string;
  /** Font weights for nation and province labels on the map. */
  labelWeight: string;
  provinceLabelWeight: string;
  /** Uppercase nation labels with wide tracking (modern look) vs. small caps-style serif. */
  labelLetterSpacing: number;
  map: MapPalette;
}

const OSWALD = '"Oswald", "Arial Narrow", sans-serif';
const CINZEL = '"Cinzel", "Trajan Pro", Georgia, serif';
const FELL = '"IM Fell English SC", "IM Fell English", Georgia, serif';
const RAJDHANI = '"Rajdhani", "Segoe UI", sans-serif';

/** WW1 / WW2: sepia paper, olive drab, brass. */
const sepia: Theme = {
  id: 'sepia', displayFont: OSWALD, labelFont: OSWALD, labelWeight: '600', provinceLabelWeight: '500', labelLetterSpacing: 3,
  map: {
    graticule: 0x2f4a52, graticuleAlpha: 0.1,
    shore: 0xdfe7dc, shoreAlpha: 0.35,
    coast: 0x2a3b3f,
    nationBorder: 0x1d2424,
    provinceBorder: 0x1d2424, provinceBorderAlpha: 0.22,
    landShadow: 0x1f2e30, landShadowAlpha: 0.28,
    unclaimed: 0xc8bfa3,
    paper: '#e9dcc0', paperMix: 0.16,
    labelFill: '#fbf6ea', labelStroke: '#2a2620',
    provinceLabelFill: '#1f1d19', provinceLabelStroke: '#f1e8d4',
    hover: 0xfff4d6, selection: 0xffd34d, capital: 0x1f1d19,
  },
};

/** Bronze Age: an old map on parchment, ink borders. */
const parchment: Theme = {
  id: 'parchment', displayFont: FELL, labelFont: FELL, labelWeight: '400', provinceLabelWeight: '400', labelLetterSpacing: 4,
  map: {
    graticule: 0x5a3e1e, graticuleAlpha: 0.12,
    shore: 0xf2e6c4, shoreAlpha: 0.5,
    coast: 0x4a3218,
    nationBorder: 0x3a2410,
    provinceBorder: 0x4a3218, provinceBorderAlpha: 0.25,
    landShadow: 0x3a2a14, landShadowAlpha: 0.22,
    unclaimed: 0xdcc89a,
    paper: '#e8d2a0', paperMix: 0.42,
    labelFill: '#2e1d0c', labelStroke: '#f4e6c2',
    provinceLabelFill: '#2e1d0c', provinceLabelStroke: '#efe0b8',
    hover: 0xfff2cc, selection: 0xc0392b, capital: 0x2e1d0c,
  },
};

/** Rome: white marble, Mediterranean blue, gold. */
const marble: Theme = {
  id: 'marble', displayFont: CINZEL, labelFont: CINZEL, labelWeight: '700', provinceLabelWeight: '500', labelLetterSpacing: 3,
  map: {
    graticule: 0x2f5e70, graticuleAlpha: 0.09,
    shore: 0xeaf4f6, shoreAlpha: 0.45,
    coast: 0x3c4a4e,
    nationBorder: 0x3a3226,
    provinceBorder: 0x3a3226, provinceBorderAlpha: 0.2,
    landShadow: 0x23343a, landShadowAlpha: 0.22,
    unclaimed: 0xe2dccb,
    paper: '#f4efe4', paperMix: 0.28,
    labelFill: '#fffaf0', labelStroke: '#4a3c22',
    provinceLabelFill: '#2b261c', provinceLabelStroke: '#f8f3e8',
    hover: 0xfffbea, selection: 0xd4a52a, capital: 0x2b261c,
  },
};

/** Renaissance: illuminated manuscript, burgundy and gold leaf. */
const ornate: Theme = {
  id: 'ornate', displayFont: FELL, labelFont: FELL, labelWeight: '400', provinceLabelWeight: '400', labelLetterSpacing: 3,
  map: {
    graticule: 0x3a1a14, graticuleAlpha: 0.1,
    shore: 0xe7dcc0, shoreAlpha: 0.35,
    coast: 0x3a1a14,
    nationBorder: 0x3a1410,
    provinceBorder: 0x3a1a14, provinceBorderAlpha: 0.22,
    landShadow: 0x24120c, landShadowAlpha: 0.25,
    unclaimed: 0xd8c9a2,
    paper: '#efe0bf', paperMix: 0.3,
    labelFill: '#2b1208', labelStroke: '#f3e6c6',
    provinceLabelFill: '#2b1208', provinceLabelStroke: '#f0e2c0',
    hover: 0xfff0d0, selection: 0xe2b75a, capital: 0x2b1208,
  },
};

/** Modern and USA: dark command-centre display, cyan grid. */
const tactical: Theme = {
  id: 'tactical', displayFont: RAJDHANI, labelFont: RAJDHANI, labelWeight: '700', provinceLabelWeight: '600', labelLetterSpacing: 4,
  map: {
    graticule: 0x3fa9c9, graticuleAlpha: 0.12,
    shore: 0x3fa9c9, shoreAlpha: 0.22,
    coast: 0x6fd3ea,
    nationBorder: 0xbfefff,
    provinceBorder: 0x9fe3ff, provinceBorderAlpha: 0.14,
    landShadow: 0x000000, landShadowAlpha: 0.45,
    unclaimed: 0x1d2a30,
    paper: '#1a2830', paperMix: 0.45,
    labelFill: '#e6f6ff', labelStroke: '#061016',
    provinceLabelFill: '#d4eef8', provinceLabelStroke: '#061016',
    hover: 0xbff3ff, selection: 0xffd34d, capital: 0xe6f6ff,
  },
};

const themes: Record<ThemeId, Theme> = { sepia, parchment, marble, ornate, tactical };

export function getTheme(id: ThemeId): Theme {
  return themes[id] ?? sepia;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme.id;
}

/** Fonts the map renderer rasterises: load before drawing labels. */
export const themeFontsReady = (theme: Theme) =>
  Promise.all([
    document.fonts.load(`${theme.labelWeight} 32px ${theme.labelFont}`),
    document.fonts.load(`${theme.provinceLabelWeight} 11px ${theme.labelFont}`),
  ]).catch(() => undefined);

// ---- color helpers ----------------------------------------------------------------------------
export const hexToNum = (hex: string) => parseInt(hex.slice(1), 16);

export function mix(a: string, b: string, t: number): number {
  const x = hexToNum(a), y = hexToNum(b);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function lighten(c: number, t: number): number {
  const ch = (s: number) => Math.round(((c >> s) & 255) + (255 - ((c >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
