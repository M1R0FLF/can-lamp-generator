import './style.css';
import { inject as injectAnalytics } from '@vercel/analytics';
import { generate, GenerateResult, SourceSpec, resultToSvg, DESIGN_HEIGHT_MM } from './engine/generate';
import { PRESETS, getPreset } from './engine/presets';
import { Hole, StippleMode, StippleParams, DEFAULT_STIPPLE } from './engine/stipple';
import { renderGlow } from './engine/glow';
import { createCan3D, CAN_STYLES, Can3D } from './render3d';
import {
  CustomShape,
  makeShape,
  starterShapes,
  isFullWidth,
  canRotate,
  alignShapes,
  AlignMode,
  distributeAround,
  distributeVertical,
  mirrorShapes,
  duplicateShapes,
  ringArray,
  nudgeShapes,
  CUSTOM_STIPPLE,
} from './engine/customShapes';
import {
  SHAPE_CATEGORIES,
  ShapeCategory,
  shapesInCategory,
  getShapeDef,
} from './engine/shapes/library';
import {
  QUALITY_PRESETS,
  DEFAULT_QUALITY_INDEX,
  DEFAULT_MIN_WEB_TARGET,
  DEFAULT_LASER_SPEED,
  DEFAULT_LASER_PASSES,
  estimateCutSeconds,
} from './engine/qualityPresets';
import { CAN_SIZES, DEFAULT_CAN, clampCan, aspectWarning, matchCanSize } from './engine/canSizes';

const PPM_DRAFT = 4;
const PPM_FULL = 7;
// Fixed px/mm for the flat preview — NOT fit-to-container. A can with a
// bigger diameter is just a wider image; the wrapper scrolls horizontally
// (CLAUDE.md-adjacent lesson: shrinking-to-fit made large cans unreadable).
const FLAT_SP = 4.6;

type SourceKind = 'preset' | 'custom';
type HoleMode = 'varying' | 'fixed';
type PreviewMode = 'lit' | 'unlit' | 'field';
type ViewMode = 'both' | 'flat' | 'can';

interface State {
  diameterMm: number;
  heightMm: number;
  sourceKind: SourceKind;
  presetId: string;
  qualityIndex: number;
  holeMode: HoleMode;
  fixedDiameter: number;
  /** stipple overrides the user has explicitly touched */
  overrides: Partial<StippleParams>;
  minWebTarget: number;
  laserSpeed: number;
  laserPasses: number;
  previewMode: PreviewMode;
  viewMode: ViewMode;
  tile2x: boolean;
  turns: number;
  shapes: CustomShape[];
  selectedIds: Set<string>;
  paletteCategory: ShapeCategory;
  /** which band of the 142mm reference design shows on a shorter can: 0=bottom, 1=top */
  panY: number;
  canStyleId: string;
}

const state: State = {
  diameterMm: DEFAULT_CAN.diameterMm,
  heightMm: DEFAULT_CAN.heightMm,
  sourceKind: 'preset',
  presetId: PRESETS[0].id,
  qualityIndex: DEFAULT_QUALITY_INDEX,
  holeMode: 'varying',
  fixedDiameter: 0.35,
  overrides: {},
  minWebTarget: DEFAULT_MIN_WEB_TARGET,
  laserSpeed: DEFAULT_LASER_SPEED,
  laserPasses: DEFAULT_LASER_PASSES,
  previewMode: 'lit',
  viewMode: 'both',
  tile2x: false,
  turns: 0,
  shapes: starterShapes(),
  selectedIds: new Set<string>(),
  paletteCategory: 'basic',
  panY: 0,
  canStyleId: CAN_STYLES[0].id,
};

let result: GenerateResult | null = null;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, v: string) => {
  const n = document.getElementById(id);
  if (n) n.textContent = v;
};

// ---------- preset list ----------
const presetSelect = el<HTMLSelectElement>('preset');
{
  const groups = new Map<string, typeof PRESETS>();
  for (const p of PRESETS) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  }
  for (const [group, items] of groups) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const p of items) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      og.appendChild(opt);
    }
    presetSelect.appendChild(og);
  }
  presetSelect.value = state.presetId;
}

// ---------- resolve the stipple params in play ----------
function effectiveStipple(): StippleParams {
  const designPart =
    state.sourceKind === 'preset' ? getPreset(state.presetId).stipple : CUSTOM_STIPPLE;
  const q = QUALITY_PRESETS[state.qualityIndex];
  const qualityPart = q
    ? { pitchMm: q.pitch, dMin: q.dMin, dMax: q.dMax, jitter: q.jitter }
    : {};
  const base: StippleParams = {
    ...DEFAULT_STIPPLE,
    ...designPart,
    ...qualityPart,
    ...state.overrides,
  };
  if (state.holeMode === 'fixed') {
    base.mode = 'fm';
    base.fixedDiameterMm = state.fixedDiameter;
  } else if (base.mode === 'fm') {
    base.mode = 'hybrid';
  }
  return base;
}

// ---------- generation ----------
function regenerate(ppm: number) {
  const source: SourceSpec =
    state.sourceKind === 'custom'
      ? { kind: 'custom', shapes: state.shapes }
      : { kind: 'preset', presetId: state.presetId };
  result = generate(
    { diameterMm: state.diameterMm, heightMm: state.heightMm, ppm, panY: state.panY },
    source,
    effectiveStipple()
  );
  renderCropRail();
  renderReadout();
  renderPreviews();
}

function renderCropRail() {
  const cw = result?.cropWindow ?? null;
  el('cropRail').style.display = cw ? 'flex' : 'none';
  el<HTMLCanvasElement>('flatCanvas').classList.toggle('croppable', !!cw);
  if (cw && result) {
    setText(
      'cropReadout',
      `Keeping ${cw.fromMm.toFixed(0)}–${cw.toMm.toFixed(0)} mm of the ${result.designH.toFixed(0)} mm design — drag the lit band or the slider`
    );
  } else {
    setText('cropReadout', '');
  }
}

// ---------- readout ----------
function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function renderReadout() {
  if (!result) {
    setText('roHoleCount', '—');
    setText('roMinWeb', '—');
    return;
  }
  const r = result;
  setText('roCanvas', `${r.W.toFixed(1)} × ${r.H.toFixed(1)} mm`);
  setText('roGrid', `${r.cols} × ${r.rows}`);
  setText('roHoleCount', r.holes.length.toLocaleString());

  const minWebEl = el('roMinWeb');
  minWebEl.textContent = Number.isFinite(r.minWeb) ? `${r.minWeb.toFixed(3)} mm` : '—';
  minWebEl.className = 'value ' + (r.minWeb < state.minWebTarget ? 'danger' : 'ok');

  let area = 0;
  for (const h of r.holes) area += Math.PI * h.r * h.r;
  setText('roOpenArea', `${((100 * area) / (r.W * r.H)).toFixed(1)} %`);
  setText('roCutTime', formatDuration(estimateCutSeconds(r.holes.length, state.laserSpeed, state.laserPasses)));
  setText('roGenTime', `${(r.buildMs + r.sampleMs).toFixed(0)} ms`);
}

// ---------- previews ----------
function dotsCanvas(holes: Hole[], W: number, H: number, sp: number, tiles: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * sp * tiles);
  c.height = Math.round(H * sp);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  for (let t = 0; t < tiles; t++) {
    const dx = t * W * sp;
    for (const h of holes) {
      ctx.beginPath();
      ctx.arc(h.x * sp + dx, h.y * sp, Math.max(0.45, h.r * sp), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

function unlitCanvas(holes: Hole[], W: number, H: number, sp: number, tiles: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * sp * tiles);
  c.height = Math.round(H * sp);
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#b3afab');
  grad.addColorStop(0.5, '#928e8a');
  grad.addColorStop(1, '#a8a4a0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#26251f';
  for (let t = 0; t < tiles; t++) {
    const dx = t * W * sp;
    for (const h of holes) {
      ctx.beginPath();
      ctx.arc(h.x * sp + dx, h.y * sp, Math.max(0.45, h.r * sp), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

function fieldCanvas(r: GenerateResult, sp: number, tiles: number): HTMLCanvasElement {
  const src = document.createElement('canvas');
  src.width = r.Wp;
  src.height = r.Hp;
  const sctx = src.getContext('2d')!;
  const img = sctx.createImageData(r.Wp, r.Hp);
  for (let i = 0; i < r.field.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, r.field[i])) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  // `field` is always stored at design height, so scale to that — not the can
  // height, which would squash it whenever a crop is in play.
  const c = document.createElement('canvas');
  c.width = Math.round(r.W * sp * tiles);
  c.height = Math.round(r.designH * sp);
  const ctx = c.getContext('2d')!;
  for (let t = 0; t < tiles; t++) {
    ctx.drawImage(src, t * r.W * sp, 0, r.W * sp, r.designH * sp);
  }
  return c;
}

let can3d: Can3D | null = null;

/** Transparent-background overlay: dark filled circles at hole positions,
 * for compositing over a colored can body in unlit 3D mode (the flat unlit
 * preview instead paints an opaque aluminum-gradient background, which would
 * hide the body color entirely). */
function unlitOverlay(holes: Hole[], W: number, H: number, sp: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * sp);
  c.height = Math.round(H * sp);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(15,13,10,0.85)';
  for (const h of holes) {
    ctx.beginPath();
    ctx.arc(h.x * sp, h.y * sp, Math.max(0.45, h.r * sp), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Dim the parts of the design the current crop window throws away, and
 * outline the part that survives, so the crop is visible rather than implied. */
function overlayCrop(canvas: HTMLCanvasElement, r: GenerateResult, sp: number) {
  if (!r.cropWindow) return;
  const ctx = canvas.getContext('2d')!;
  // canvas y runs downward from the top of the design
  const keepTopPx = (r.designH - r.cropWindow.toMm) * sp;
  const keepBotPx = (r.designH - r.cropWindow.fromMm) * sp;

  ctx.save();
  ctx.fillStyle = 'rgba(8,9,11,0.76)';
  ctx.fillRect(0, 0, canvas.width, keepTopPx);
  ctx.fillRect(0, keepBotPx, canvas.width, canvas.height - keepBotPx);

  ctx.strokeStyle = 'rgba(224,164,90,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(0, keepTopPx);
  ctx.lineTo(canvas.width, keepTopPx);
  ctx.moveTo(0, keepBotPx);
  ctx.lineTo(canvas.width, keepBotPx);
  ctx.stroke();
  ctx.restore();
}

function renderPreviews() {
  if (!result) return;
  const r = result;
  const tiles = state.tile2x ? 2 : 1;
  const sp = FLAT_SP;
  const pane = document.querySelector('main.preview') as HTMLElement | null;

  // When cropping, the flat view shows the WHOLE design (so you can see what
  // you're choosing between) with the discarded bands dimmed. Otherwise it
  // shows the can content directly.
  const cropping = !!r.cropWindow;
  const flatHoles = cropping ? r.designHoles : r.holes;
  const flatH = cropping ? r.designH : r.H;

  let flat: HTMLCanvasElement;
  if (state.previewMode === 'lit') {
    flat = renderGlow(dotsCanvas(flatHoles, r.W, flatH, sp, tiles), sp);
  } else if (state.previewMode === 'unlit') {
    flat = unlitCanvas(flatHoles, r.W, flatH, sp, tiles);
  } else {
    flat = fieldCanvas(r, sp, tiles);
  }

  const flatCanvas = el<HTMLCanvasElement>('flatCanvas');
  flatCanvas.width = flat.width;
  flatCanvas.height = flat.height;
  flatCanvas.getContext('2d')!.drawImage(flat, 0, 0);
  overlayCrop(flatCanvas, r, sp);

  // keep the rail's track the same height as the preview it annotates
  el('cropRail').style.height = `${flat.height}px`;

  // the 3D view always wraps a single (untiled) copy, at its own resolution
  const texSp = Math.max(3, Math.min(6, 700 / r.W));
  const lit = state.previewMode === 'lit';
  const texture = lit
    ? renderGlow(dotsCanvas(r.holes, r.W, r.H, texSp, 1), texSp)
    : unlitOverlay(r.holes, r.W, r.H, texSp);

  if (can3d) {
    // give the can whatever vertical room the pane actually has, so "3D only"
    // fills the view instead of needing a scroll
    // 250px covers the toolbar, block heading, rotate row, hint and padding
    // that sit around the stage, so "3D only" fits without a scrollbar
    const paneH = pane?.clientHeight ?? 600;
    const maxHeightPx = state.viewMode === 'can' ? Math.max(260, paneH - 250) : 520;
    can3d.update({
      texture,
      lit,
      style: CAN_STYLES.find((s) => s.id === state.canStyleId) ?? CAN_STYLES[0],
      diameterMm: state.diameterMm,
      heightMm: state.heightMm,
      maxHeightPx,
    });
  }
}

function applyViewMode() {
  el('flatBlock').style.display = state.viewMode === 'can' ? 'none' : 'block';
  el('canBlock').style.display = state.viewMode === 'flat' ? 'none' : 'block';
  for (const b of el('viewSeg').querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.view === state.viewMode);
  }
}

// ---------- input sync ----------
function syncInputs() {
  const s = effectiveStipple();
  const set = (id: string, v: string) => {
    const n = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (n) n.value = v;
  };
  set('diameter', String(state.diameterMm));
  set('height', String(state.heightMm));
  set('quality', String(state.qualityIndex));
  set('preset', state.presetId);
  set('fixedDiameter', state.fixedDiameter.toFixed(2));
  set('pitch', s.pitchMm.toFixed(2));
  set('dMin', s.dMin.toFixed(2));
  set('dMax', s.dMax.toFixed(2));
  set('jitter', s.jitter.toFixed(2));
  set('thresh', s.thresh.toFixed(2));
  set('knee', s.knee.toFixed(2));
  set('stippleGamma', s.gamma.toFixed(2));
  set('toneMode', s.mode);
  set('minWebTarget', state.minWebTarget.toFixed(2));
  set('laserSpeed', String(state.laserSpeed));
  set('laserPasses', String(state.laserPasses));
  set('panY', String(state.panY));

  setText('diameterVal', `${state.diameterMm.toFixed(1)} mm`);
  setText('heightVal', `${state.heightMm.toFixed(1)} mm`);

  const matched = matchCanSize(state.diameterMm, state.heightMm);
  const sizeSel = document.getElementById('canSize') as HTMLSelectElement | null;
  if (sizeSel) sizeSel.value = matched ? matched.id : 'custom';
  const warn = aspectWarning(state.diameterMm, state.heightMm);
  const warnEl = document.getElementById('aspectWarn');
  if (warnEl) {
    warnEl.style.display = warn ? 'block' : 'none';
    warnEl.textContent = warn ?? '';
    warnEl.style.color = 'var(--accent)';
  }
  setText('qualityLabel', QUALITY_PRESETS[state.qualityIndex]?.label ?? 'Custom');
  setText('fixedDiameterVal', state.fixedDiameter.toFixed(2));
  setText('pitchVal', s.pitchMm.toFixed(2));
  setText('dMinVal', s.dMin.toFixed(2));
  setText('dMaxVal', s.dMax.toFixed(2));
  setText('jitterVal', s.jitter.toFixed(2));
  setText('threshVal', s.thresh.toFixed(2));
  setText('kneeVal', s.knee.toFixed(2));
  setText('stippleGammaVal', s.gamma.toFixed(2));
  setText('minWebTargetVal', state.minWebTarget.toFixed(2));
  setText('laserSpeedVal', `${state.laserSpeed} mm/s`);
  setText('laserPassesVal', String(state.laserPasses));
  setText('presetDesc', getPreset(state.presetId).description);
}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: number | undefined;
  return ((...a: any[]) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  }) as T;
}
const fullRegen = debounce(() => regenerate(PPM_FULL), 220);
const draftThenFull = () => {
  regenerate(PPM_DRAFT);
  fullRegen();
};

// ---------- wiring ----------
function numInput(id: string, apply: (v: number) => void, immediate = false) {
  const input = el<HTMLInputElement>(id);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    apply(v);
    syncInputs();
    if (immediate) {
      renderReadout();
      renderPreviews();
    } else {
      draftThenFull();
    }
  });
}

numInput('diameter', (v) => {
  state.diameterMm = clampCan(v, state.heightMm).diameterMm;
});
numInput('height', (v) => {
  state.heightMm = clampCan(state.diameterMm, v).heightMm;
});
numInput('fixedDiameter', (v) => (state.fixedDiameter = v));

// ---------- can size catalogue ----------
const canSizeSelect = el<HTMLSelectElement>('canSize');
{
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom';
  canSizeSelect.appendChild(custom);
  for (const c of CAN_SIZES) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    canSizeSelect.appendChild(opt);
  }
}
canSizeSelect.addEventListener('change', () => {
  const c = CAN_SIZES.find((s) => s.id === canSizeSelect.value);
  if (!c) return;
  state.diameterMm = c.diameterMm;
  state.heightMm = c.heightMm;
  state.panY = 0;
  syncInputs();
  draftThenFull();
});

el<HTMLInputElement>('quality').addEventListener('input', () => {
  state.qualityIndex = parseInt(el<HTMLInputElement>('quality').value, 10);
  // a quality change replaces the geometry tuple, so drop stale overrides of it
  delete state.overrides.pitchMm;
  delete state.overrides.dMin;
  delete state.overrides.dMax;
  delete state.overrides.jitter;
  syncInputs();
  regenerate(PPM_DRAFT);
});
el<HTMLInputElement>('quality').addEventListener('change', () => regenerate(PPM_FULL));

presetSelect.addEventListener('change', () => {
  state.presetId = presetSelect.value;
  // presets carry their own tuned tone params; clear per-design overrides
  state.overrides = {};
  syncInputs();
  draftThenFull();
});

for (const [id, key] of [
  ['pitch', 'pitchMm'],
  ['dMin', 'dMin'],
  ['dMax', 'dMax'],
  ['jitter', 'jitter'],
  ['thresh', 'thresh'],
  ['knee', 'knee'],
  ['stippleGamma', 'gamma'],
] as Array<[string, keyof StippleParams]>) {
  numInput(id, (v) => {
    (state.overrides as any)[key] = v;
  });
}

el<HTMLSelectElement>('toneMode').addEventListener('change', () => {
  state.overrides.mode = el<HTMLSelectElement>('toneMode').value as StippleMode;
  if (state.overrides.mode === 'fm') state.holeMode = 'fixed';
  else state.holeMode = 'varying';
  for (const b of el('holeModeSeg').querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.mode === state.holeMode);
  }
  el('fixedDiameterField').style.display = state.holeMode === 'fixed' ? 'block' : 'none';
  syncInputs();
  draftThenFull();
});

numInput('minWebTarget', (v) => (state.minWebTarget = v), true);
numInput('laserSpeed', (v) => (state.laserSpeed = v), true);
numInput('laserPasses', (v) => (state.laserPasses = Math.round(v)), true);

// source toggle
el('sourceSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.sourceKind = btn.dataset.source as SourceKind;
  for (const b of el('sourceSeg').querySelectorAll('button')) b.classList.toggle('active', b === btn);
  el('presetPane').style.display = state.sourceKind === 'preset' ? 'block' : 'none';
  el('customPane').style.display = state.sourceKind === 'custom' ? 'block' : 'none';
  state.overrides = {};
  syncInputs();
  draftThenFull();
  if (state.sourceKind === 'custom') renderEditor();
});

// hole mode
el('holeModeSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.holeMode = btn.dataset.mode as HoleMode;
  delete state.overrides.mode;
  for (const b of el('holeModeSeg').querySelectorAll('button')) b.classList.toggle('active', b === btn);
  el('fixedDiameterField').style.display = state.holeMode === 'fixed' ? 'block' : 'none';
  syncInputs();
  draftThenFull();
});

// preview mode
document.querySelectorAll('button[data-preview]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.previewMode = (btn as HTMLElement).dataset.preview as PreviewMode;
    btn.parentElement!.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    renderPreviews();
  });
});

el<HTMLInputElement>('tile2x').addEventListener('change', () => {
  state.tile2x = el<HTMLInputElement>('tile2x').checked;
  renderPreviews();
});

// which preview panes are shown — lets you work on the 3D can without
// scrolling past the flat view every time
el('viewSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.viewMode = btn.dataset.view as ViewMode;
  applyViewMode();
  renderPreviews();
});

el<HTMLInputElement>('rotate').addEventListener('input', () => {
  state.turns = parseFloat(el<HTMLInputElement>('rotate').value);
  can3d?.setRotationDeg(state.turns * 360);
});

el<HTMLInputElement>('panY').addEventListener('input', () => {
  state.panY = parseFloat(el<HTMLInputElement>('panY').value);
  draftThenFull();
});

// --- drag the lit band directly on the flat preview to reposition the crop ---
{
  const flatCanvas = el<HTMLCanvasElement>('flatCanvas');
  let cropDrag: { startClientY: number; startPanY: number; span: number } | null = null;

  flatCanvas.addEventListener('pointerdown', (e) => {
    if (!result?.cropWindow) return;
    const span = result.designH - result.H;
    if (span <= 0) return;
    cropDrag = { startClientY: e.clientY, startPanY: state.panY, span };
    flatCanvas.setPointerCapture(e.pointerId);
  });
  flatCanvas.addEventListener('pointermove', (e) => {
    if (!cropDrag || !result) return;
    const rect = flatCanvas.getBoundingClientRect();
    const pxPerMm = (flatCanvas.height / rect.height) * FLAT_SP;
    // canvas y grows downward while design y grows upward, hence the negation
    const deltaMm = -(e.clientY - cropDrag.startClientY) / pxPerMm;
    const next = cropDrag.startPanY + deltaMm / cropDrag.span;
    state.panY = Math.min(1, Math.max(0, next));
    el<HTMLInputElement>('panY').value = String(state.panY);
    regenerate(PPM_DRAFT);
  });
  const endCropDrag = () => {
    if (!cropDrag) return;
    cropDrag = null;
    fullRegen();
  };
  flatCanvas.addEventListener('pointerup', endCropDrag);
  flatCanvas.addEventListener('pointercancel', endCropDrag);
}

// ---------- 3D can ----------
const canStyleSelect = el<HTMLSelectElement>('canStyle');
for (const style of CAN_STYLES) {
  const opt = document.createElement('option');
  opt.value = style.id;
  opt.textContent = style.name;
  canStyleSelect.appendChild(opt);
}
canStyleSelect.value = state.canStyleId;
canStyleSelect.addEventListener('change', () => {
  state.canStyleId = canStyleSelect.value;
  renderPreviews();
});

can3d = createCan3D(el('can3dMount'));
can3d.stage.addEventListener('can3d-rotate', ((e: CustomEvent<number>) => {
  state.turns = (((e.detail % 360) + 360) % 360) / 360;
  el<HTMLInputElement>('rotate').value = String(state.turns);
}) as EventListener);

// ---------- composer ----------
//
// The editor canvas draws the ACTUAL generated field rather than a hand-drawn
// schematic, so what you arrange is exactly what gets cut. Selection is drawn
// on top as outlines. (With 56 stamps in the library, maintaining a separate
// schematic per shape would drift out of sync immediately.)
const editorCanvas = el<HTMLCanvasElement>('editorCanvas');
let editorSp = 4;

function editorSize() {
  const wrap = el('editorWrap');
  const avail = Math.max(240, wrap.clientWidth || 300);
  const W = Math.PI * state.diameterMm;
  editorSp = Math.max(1.1, Math.min(6, avail / W));
  editorCanvas.width = Math.round(W * editorSp);
  editorCanvas.height = Math.round(state.heightMm * editorSp);
}

function renderEditor() {
  editorSize();
  const ctx2d = editorCanvas.getContext('2d')!;
  const W = Math.PI * state.diameterMm;
  const H = state.heightMm;
  ctx2d.fillStyle = '#0a0b0d';
  ctx2d.fillRect(0, 0, editorCanvas.width, editorCanvas.height);

  // the real field, so the editor is WYSIWYG
  if (result && result.field.length === result.Wp * result.Hp) {
    const src = document.createElement('canvas');
    src.width = result.Wp;
    src.height = result.Hp;
    const sctx = src.getContext('2d')!;
    const img = sctx.createImageData(result.Wp, result.Hp);
    for (let i = 0; i < result.field.length; i++) {
      const v = Math.round(Math.min(1, Math.max(0, result.field[i])) * 255);
      img.data[i * 4] = Math.round(v * 0.88);
      img.data[i * 4 + 1] = Math.round(v * 0.64);
      img.data[i * 4 + 2] = Math.round(v * 0.35);
      img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx2d.drawImage(src, 0, 0, editorCanvas.width, editorCanvas.height);
  }

  // selection outlines
  ctx2d.save();
  ctx2d.lineWidth = 1.5;
  ctx2d.setLineDash([5, 3]);
  for (const s of state.shapes) {
    if (!state.selectedIds.has(s.id)) continue;
    ctx2d.strokeStyle = '#ffd08a';
    const cy = (H - s.yFrac * H) * editorSp;
    if (isFullWidth(s)) {
      const h = Math.max(6, s.size * 2 * editorSp);
      ctx2d.strokeRect(1, cy - h / 2, editorCanvas.width - 2, h);
    } else {
      const cx = s.xFrac * W * editorSp;
      const r = Math.max(5, s.size * editorSp);
      ctx2d.strokeRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  ctx2d.restore();
}

function selectedShapes(): CustomShape[] {
  return state.shapes.filter((s) => state.selectedIds.has(s.id));
}

function refreshComposerUI() {
  const picked = selectedShapes();
  const propsEl = el('shapeProps');
  propsEl.style.display = picked.length ? 'block' : 'none';
  if (picked.length) {
    const first = picked[0];
    el<HTMLInputElement>('shapeSize').value = String(first.size);
    el<HTMLInputElement>('shapeRot').value = String(first.rotation);
    setText('shapeSizeVal', `${first.size.toFixed(1)} mm`);
    setText('shapeRotVal', `${first.rotation.toFixed(0)}°`);
    const rotField = el('shapeRot').closest('.field') as HTMLElement;
    rotField.style.display = picked.some(canRotate) ? 'block' : 'none';
  }

  // align/arrange need at least two shapes to mean anything
  const multi = picked.length >= 2;
  document.querySelectorAll<HTMLButtonElement>('#customPane [data-align]').forEach((b) => {
    b.disabled = !multi;
  });
  for (const [tool, min] of [
    ['distributeAround', 2],
    ['distributeVertical', 3],
    ['mirrorH', 1],
    ['mirrorV', 1],
    ['duplicate', 1],
    ['ringArray', 1],
  ] as Array<[string, number]>) {
    const b = document.querySelector<HTMLButtonElement>(`#customPane [data-tool="${tool}"]`);
    if (b) b.disabled = picked.length < min;
  }

  setText(
    'selInfo',
    picked.length === 0
      ? `${state.shapes.length} shape${state.shapes.length === 1 ? '' : 's'} placed — click one to select`
      : `${picked.length} of ${state.shapes.length} selected`
  );
}

/** Rebuild after any structural change to the shape list. */
function composerChanged() {
  refreshComposerUI();
  draftThenFull();
}

// ---------- palette ----------
function buildCategoryTabs() {
  const tabs = el('catTabs');
  tabs.innerHTML = '';
  for (const cat of SHAPE_CATEGORIES) {
    const b = document.createElement('button');
    b.textContent = cat.name;
    b.dataset.cat = cat.id;
    b.classList.toggle('active', cat.id === state.paletteCategory);
    b.addEventListener('click', () => {
      state.paletteCategory = cat.id;
      buildCategoryTabs();
      buildPalette();
    });
    tabs.appendChild(b);
  }
}

function buildPalette() {
  const pal = el('palette');
  pal.innerHTML = '';
  for (const def of shapesInCategory(state.paletteCategory)) {
    const b = document.createElement('button');
    b.textContent = def.glyph;
    b.title = `${def.name} — drag onto the canvas`;
    b.dataset.shape = def.id;
    attachPaletteDrag(b, def.id);
    pal.appendChild(b);
  }
}

/** Pointer-drag a stamp from the palette onto the editor canvas. */
function attachPaletteDrag(btn: HTMLElement, shapeId: string) {
  btn.addEventListener('pointerdown', (e0) => {
    const e = e0 as PointerEvent;
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    document.body.appendChild(ghost);
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    btn.classList.add('dragging');

    const move = (ev: PointerEvent) => {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      btn.classList.remove('dragging');
      ghost.remove();
      const rect = editorCanvas.getBoundingClientRect();
      const inside =
        ev.clientX >= rect.left && ev.clientX <= rect.right &&
        ev.clientY >= rect.top && ev.clientY <= rect.bottom;
      // dropping anywhere outside still places it, centred — a click on the
      // palette should never feel like it did nothing
      const xf = inside ? (ev.clientX - rect.left) / rect.width : 0.5;
      const yf = inside ? 1 - (ev.clientY - rect.top) / rect.height : 0.5;
      const shape = makeShape(shapeId, ((xf % 1) + 1) % 1, Math.min(0.97, Math.max(0.03, yf)));
      state.shapes.push(shape);
      state.selectedIds = new Set([shape.id]);
      composerChanged();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

// ---------- canvas selection + drag ----------
function pickShapeAt(xFrac: number, yFrac: number): CustomShape | null {
  const W = Math.PI * state.diameterMm;
  const H = state.heightMm;
  let best: CustomShape | null = null;
  let bestD = Infinity;
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (isFullWidth(s)) {
      if (Math.abs((yFrac - s.yFrac) * H) < s.size + 2) return s;
      continue;
    }
    let dx = (xFrac - s.xFrac) * W;
    dx = (((dx + W / 2) % W) + W) % W - W / 2;
    const dy = (yFrac - s.yFrac) * H;
    const d = Math.hypot(dx, dy);
    if (d < s.size * 1.2 && d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function canvasEventToFrac(e: PointerEvent): [number, number] {
  const rect = editorCanvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) / rect.width,
    1 - (e.clientY - rect.top) / rect.height,
  ];
}

let shapeDrag: { lastX: number; lastY: number; moved: boolean } | null = null;

editorCanvas.addEventListener('pointerdown', (e) => {
  const [xf, yf] = canvasEventToFrac(e);
  const hit = pickShapeAt(xf, yf);
  if (!hit) {
    if (!e.shiftKey) state.selectedIds = new Set();
    refreshComposerUI();
    renderEditor();
    return;
  }
  if (e.shiftKey) {
    if (state.selectedIds.has(hit.id)) state.selectedIds.delete(hit.id);
    else state.selectedIds.add(hit.id);
  } else if (!state.selectedIds.has(hit.id)) {
    state.selectedIds = new Set([hit.id]);
  }
  refreshComposerUI();
  renderEditor();
  if (state.selectedIds.size) {
    shapeDrag = { lastX: xf, lastY: yf, moved: false };
    editorCanvas.setPointerCapture(e.pointerId);
  }
});

editorCanvas.addEventListener('pointermove', (e) => {
  if (!shapeDrag) return;
  const [xf, yf] = canvasEventToFrac(e);
  const dx = xf - shapeDrag.lastX;
  const dy = yf - shapeDrag.lastY;
  if (dx === 0 && dy === 0) return;
  shapeDrag.lastX = xf;
  shapeDrag.lastY = yf;
  shapeDrag.moved = true;
  // move the whole selection together
  state.shapes = nudgeShapes(state.shapes, state.selectedIds, dx, dy);
  renderEditor();
});

function endShapeDrag() {
  if (!shapeDrag) return;
  const moved = shapeDrag.moved;
  shapeDrag = null;
  if (moved) draftThenFull();
}
editorCanvas.addEventListener('pointerup', endShapeDrag);
editorCanvas.addEventListener('pointercancel', endShapeDrag);

// ---------- align / arrange tools ----------
el('customPane').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn || btn.disabled) return;

  const align = btn.dataset.align as AlignMode | undefined;
  if (align) {
    state.shapes = alignShapes(state.shapes, state.selectedIds, align);
    composerChanged();
    renderEditor();
    return;
  }

  switch (btn.dataset.tool) {
    case 'distributeAround':
      state.shapes = distributeAround(state.shapes, state.selectedIds);
      break;
    case 'distributeVertical':
      state.shapes = distributeVertical(state.shapes, state.selectedIds);
      break;
    case 'mirrorH':
      state.shapes = mirrorShapes(state.shapes, state.selectedIds, 'h');
      break;
    case 'mirrorV':
      state.shapes = mirrorShapes(state.shapes, state.selectedIds, 'v');
      break;
    case 'duplicate': {
      const r = duplicateShapes(state.shapes, state.selectedIds);
      state.shapes = r.shapes;
      if (r.newIds.length) state.selectedIds = new Set(r.newIds);
      break;
    }
    case 'ringArray': {
      const n = parseInt(el<HTMLInputElement>('ringCount').value, 10) || 6;
      const r = ringArray(state.shapes, state.selectedIds, n);
      state.shapes = r.shapes;
      break;
    }
    default:
      return;
  }
  composerChanged();
  renderEditor();
});

// ---------- per-shape properties ----------
el<HTMLInputElement>('shapeSize').addEventListener('input', () => {
  const v = parseFloat(el<HTMLInputElement>('shapeSize').value);
  if (!Number.isFinite(v)) return;
  state.shapes = state.shapes.map((s) => (state.selectedIds.has(s.id) ? { ...s, size: v } : s));
  setText('shapeSizeVal', `${v.toFixed(1)} mm`);
  renderEditor();
  draftThenFull();
});
el<HTMLInputElement>('shapeRot').addEventListener('input', () => {
  const v = parseFloat(el<HTMLInputElement>('shapeRot').value);
  if (!Number.isFinite(v)) return;
  state.shapes = state.shapes.map((s) =>
    state.selectedIds.has(s.id) && canRotate(s) ? { ...s, rotation: v } : s
  );
  setText('shapeRotVal', `${v.toFixed(0)}°`);
  renderEditor();
  draftThenFull();
});

function deleteSelected() {
  if (!state.selectedIds.size) return;
  state.shapes = state.shapes.filter((s) => !state.selectedIds.has(s.id));
  state.selectedIds = new Set();
  composerChanged();
  renderEditor();
}

el<HTMLButtonElement>('deleteShape').addEventListener('click', deleteSelected);
el<HTMLButtonElement>('clearShapes').addEventListener('click', () => {
  state.shapes = [];
  state.selectedIds = new Set();
  composerChanged();
  renderEditor();
});

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  if (state.sourceKind !== 'custom' || !state.selectedIds.size) return;
  const t = e.target as HTMLElement | null;
  // never hijack typing in a field
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
    return;
  }
  const step = e.shiftKey ? 0.02 : 0.004;
  let dx = 0;
  let dy = 0;
  if (e.key === 'ArrowLeft') dx = -step;
  else if (e.key === 'ArrowRight') dx = step;
  else if (e.key === 'ArrowUp') dy = step;
  else if (e.key === 'ArrowDown') dy = -step;
  else return;
  e.preventDefault();
  state.shapes = nudgeShapes(state.shapes, state.selectedIds, dx, dy);
  renderEditor();
  draftThenFull();
});

buildCategoryTabs();
buildPalette();
refreshComposerUI();

window.addEventListener('resize', debounce(() => {
  if (state.sourceKind === 'custom') renderEditor();
  renderPreviews();
}, 150));

// ---------- export ----------
el<HTMLButtonElement>('exportBtn').addEventListener('click', () => {
  if (!result) return;
  const name = state.sourceKind === 'preset' ? getPreset(state.presetId).name : 'my-can';
  const svg = resultToSvg(result, `${name} — ${state.diameterMm}×${state.heightMm}mm`);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${state.diameterMm}x${state.heightMm}mm.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---------- init ----------
injectAnalytics(); // no-ops locally; only sends events once served from Vercel
applyViewMode();
syncInputs();
regenerate(PPM_FULL);
(window as any).__state = state;
(window as any).__getResult = () => result;
(window as any).__renderEditor = renderEditor;
