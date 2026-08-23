import './style.css';
import { inject as injectAnalytics } from '@vercel/analytics';
import {
  generate,
  GenerateResult,
  SourceSpec,
  resultToSvg,
  DESIGN_HEIGHT_MM,
  AnnotationSpec,
} from './engine/generate';
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
  DEFAULT_OPEN_AREA_MIN_PCT,
  DEFAULT_OPEN_AREA_MAX_PCT,
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
type AnnotationAnchor = AnnotationSpec['yAnchor'];

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
  /** empty string = no annotation drawn, on either preset or custom sources */
  annotationText: string;
  annotationXFrac: number;
  annotationYAnchor: AnnotationAnchor;
  annotationYOffsetMm: number;
  annotationSizeMm: number;
  ledHoleEnabled: boolean;
  ledHoleDiameterMm: number;
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
  annotationText: '',
  annotationXFrac: 0.5,
  annotationYAnchor: 'center',
  annotationYOffsetMm: 0,
  annotationSizeMm: 16,
  ledHoleEnabled: false,
  // 3mm cable (per spec) + ~0.4mm clearance so it actually slides through
  // 0.1mm aluminium plus any grommet — tune in Advanced if that's too tight
  // or too loose once you've test-cut one.
  ledHoleDiameterMm: 3.4,
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
  const annotation: AnnotationSpec | undefined = state.annotationText.trim()
    ? {
        text: state.annotationText.trim(),
        xFrac: state.annotationXFrac,
        yAnchor: state.annotationYAnchor,
        yOffsetMm: state.annotationYOffsetMm,
        sizeMm: state.annotationSizeMm,
      }
    : undefined;
  result = generate(
    {
      diameterMm: state.diameterMm,
      heightMm: state.heightMm,
      ppm,
      panY: state.panY,
      ledHole: {
        enabled: state.ledHoleEnabled,
        diameterMm: state.ledHoleDiameterMm,
      },
    },
    source,
    effectiveStipple(),
    annotation
  );
  renderCropRail();
  renderReadout();
  renderPreviews();
  // The small editor canvas's WYSIWYG background is a snapshot of THIS
  // result.field, taken separately from the big preview. Centralized here
  // rather than left to each caller: two different call sites already forgot
  // it independently (dropping a new shape from the palette, then dragging
  // an existing one to reposition it — "only the contour appears at the new
  // place and the old shape remains" until something else happened to
  // trigger a redraw). Every regenerate() now keeps it in sync by
  // construction, so a third call site can't reintroduce the same bug.
  if (state.sourceKind === 'custom') renderEditor();
}

/**
 * Put the crop rail wherever the thing it annotates actually is.
 *
 * On wide screens it sits beside the flat preview. Phones hide that pane
 * (effectiveViewMode), which would strand the ONLY control for choosing which
 * band of the 142mm design lands on a shorter can — so on the stacked layout
 * the rail moves next to the 3D can instead. You lose the preview of what is
 * being cropped away, but you keep the choice.
 *
 * This moves the one existing element rather than adding a second slider, so
 * there is still a single #panY input and the existing handler is untouched.
 */
function placeCropRail() {
  const stacked = isStacked();
  const move = (node: HTMLElement, selector: string) => {
    const target = document.querySelector(selector);
    if (target && node.parentElement !== target) target.appendChild(node);
  };
  move(el('cropRail'), stacked ? '.can-row' : '.flat-row');
  // The readout lives in .flat-foot, which is inside the hidden flat pane — a
  // slider with no indication of the range it keeps is not much of a control.
  move(el('cropReadout'), stacked ? '#canBlock' : '.flat-foot');
}

function renderCropRail() {
  placeCropRail();
  const cw = result?.cropWindow ?? null;
  el('cropRail').style.display = cw ? 'flex' : 'none';
  el<HTMLCanvasElement>('flatCanvas').classList.toggle('croppable', !!cw);
  if (cw && result) {
    // On phones there is no lit band to drag — only the slider — so the hint
    // must not tell you to drag something that isn't on screen.
    const how = isStacked() ? 'use the slider' : 'drag the lit band or the slider';
    setText(
      'cropReadout',
      `Keeping ${cw.fromMm.toFixed(0)}–${cw.toMm.toFixed(0)} mm of the ${result.designH.toFixed(0)} mm design — ${how}`
    );
  } else {
    setText('cropReadout', '');
  }
}

// ---------- readout ----------
function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
  }
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
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
  const openAreaPct = (100 * area) / (r.W * r.H);
  const openAreaEl = el('roOpenArea');
  openAreaEl.textContent = `${openAreaPct.toFixed(1)} %`;
  const openAreaOk = openAreaPct >= DEFAULT_OPEN_AREA_MIN_PCT && openAreaPct <= DEFAULT_OPEN_AREA_MAX_PCT;
  openAreaEl.className = 'value ' + (openAreaOk ? 'ok' : 'danger');
  openAreaEl.title = openAreaOk
    ? ''
    : openAreaPct < DEFAULT_OPEN_AREA_MIN_PCT
      ? `Under ${DEFAULT_OPEN_AREA_MIN_PCT}% — reads as mostly black/empty (CLAUDE.md rule 8)`
      : `Over ${DEFAULT_OPEN_AREA_MAX_PCT}% — leaves no dark ground for contrast (CLAUDE.md rule 8)`;
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

/**
 * Draw the LED wire-hole notch as a flat, non-glowing D-shape — deliberately
 * NOT run through renderGlow. Once assembled a wire fills this opening and
 * blocks the light it would otherwise pass, so showing it as a bright glow
 * dot (like every stipple hole) misrepresents the finished lamp; the fix is
 * to leave it out of the glow pipeline entirely, not dim it. Still drawn in
 * Unlit/Field, where it IS honestly an opening in bare metal.
 *
 * `yFlatMm` is where the physical can's bottom edge falls in THIS canvas's
 * own coordinate space — same value `overlayCrop` uses for its "kept" edge
 * (`designH - fromMm`, which is just `H` when nothing is cropped), so the
 * notch lines up with the crop-window outline rather than needing its own
 * separate derivation.
 */
function drawLedNotch(
  canvas: HTMLCanvasElement,
  notch: { x: number; r: number },
  yFlatMm: number,
  W: number,
  sp: number,
  tiles: number,
  unlit: boolean,
  alpha = 1
) {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = unlit ? '#141311' : '#000';
  ctx.strokeStyle = unlit ? '#4a463f' : '#333';
  ctx.lineWidth = Math.max(1, 0.12 * notch.r * sp);
  const cy = yFlatMm * sp;
  const R = notch.r * sp;
  for (let t = 0; t < tiles; t++) {
    const cx = (notch.x + t * W) * sp;
    ctx.beginPath();
    // canvas y grows downward, so the default (clockwise) sweep from the left
    // point (angle PI) to the right point (2*PI) passes through the TOP —
    // the semicircle bulging up into the design, away from the excluded area
    // below y=H. Matches the SVG path in svg.ts's notchPath().
    ctx.arc(cx, cy, R, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
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

/** Narrow, single-column layout — same breakpoint the control panels use. */
const STACKED_QUERY = '(max-width: 900px)';
const isStacked = () => window.matchMedia(STACKED_QUERY).matches;

/**
 * Which preview panes to actually show.
 *
 * On the stacked (phone) layout the flat/unwrapped view is forced off: at the
 * fixed FLAT_SP of 4.6 px/mm only about a third of the wrap fits on a phone
 * screen, so it is all panning and no overview — not worth the space. The 3D
 * can reads fine at that width, so a phone gets the can only, whatever
 * `state.viewMode` happens to hold from a wider session.
 */
function effectiveViewMode(): ViewMode {
  return isStacked() ? 'can' : state.viewMode;
}

function renderPreviews() {
  if (!result) return;
  const r = result;
  const tiles = state.tile2x ? 2 : 1;
  const sp = FLAT_SP;
  const pane = document.querySelector('main.preview') as HTMLElement | null;
  const view = effectiveViewMode();

  // Skip the flat raster entirely when nothing will show it — renderGlow over
  // the whole wrap is the most expensive thing here.
  if (view !== 'can') {
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
    // Left out of Lit on purpose — see drawLedNotch.
    if (r.ledNotch && state.previewMode !== 'lit') {
      const yFlatMm = cropping ? r.designH - r.cropWindow!.fromMm : r.H;
      drawLedNotch(flatCanvas, r.ledNotch, yFlatMm, r.W, sp, tiles, state.previewMode === 'unlit');
    }

    // keep the rail's track the same height as the preview it annotates
    el('cropRail').style.height = `${flat.height}px`;
  }

  // the 3D view always wraps a single (untiled) copy, at its own resolution
  const texSp = Math.max(3, Math.min(6, 700 / r.W));
  const lit = state.previewMode === 'lit';
  const texture = lit
    ? renderGlow(dotsCanvas(r.holes, r.W, r.H, texSp, 1), texSp)
    : unlitOverlay(r.holes, r.W, r.H, texSp);
  // unlitOverlay is transparent-background, composited over the coloured can
  // body — draw the notch into that same overlay so it isn't lost against it.
  // Left out of `lit` on purpose, same as the flat view; see drawLedNotch.
  if (r.ledNotch && !lit) {
    // 0.85 alpha matches unlitOverlay's own hole-dot fill, so the notch reads
    // as part of the same texture rather than a harder-edged patch on top.
    drawLedNotch(texture, r.ledNotch, r.H, r.W, texSp, 1, true, 0.85);
  }

  if (can3d) {
    // give the can whatever vertical room the pane actually has, so "3D only"
    // fills the view instead of needing a scroll
    // 250px covers the toolbar, block heading, rotate row, hint and padding
    // that sit around the stage, so "3D only" fits without a scrollbar
    const paneH = pane?.clientHeight ?? 600;
    // "Both" used to hard-cap at 520 regardless of available space. The pane
    // scrolls (main.preview has overflow-y:auto), so a taller can here isn't
    // a hard layout risk the way running out of horizontal room would be —
    // 680 gives it real room to grow instead of a token bump.
    const maxHeightPx = view === 'can' ? Math.max(260, paneH - 250) : 680;
    const stacked = isStacked();
    can3d.update({
      texture,
      lit,
      style: CAN_STYLES.find((s) => s.id === state.canStyleId) ?? CAN_STYLES[0],
      diameterMm: state.diameterMm,
      heightMm: state.heightMm,
      maxHeightPx,
      // Match the flat preview's own rendered width so the two visibly line
      // up and the can gets to be as big as the pattern next to it, instead
      // of stuck at whatever mount.clientWidth's circular fallback picks
      // (see the comment in render3d.ts). Skipped when stacked: the mobile
      // layout already fits the mount to the (narrow) viewport correctly,
      // and the flat pane's own width there is much wider than the screen
      // (it pans, per effectiveViewMode) — forcing the can to match THAT
      // would blow out the phone layout instead of fixing anything.
      widthPx: stacked ? undefined : Math.round(r.W * sp),
      ledNotch: r.ledNotch,
    });
    // Stacked, the rail annotates the CAN, not the flat pane whose height the
    // branch above would normally have set — so match the stage instead.
    if (isStacked()) {
      const stage = el('can3dMount').firstElementChild as HTMLElement | null;
      const h = stage?.clientHeight || el('can3dMount').clientHeight;
      if (h > 0) el('cropRail').style.height = `${h}px`;
    }
  }
}

function applyViewMode() {
  const view = effectiveViewMode();
  el('flatBlock').style.display = view === 'can' ? 'none' : 'block';
  el('canBlock').style.display = view === 'flat' ? 'none' : 'block';
  // The Both/Flat/3D toggle is meaningless when the flat pane is forced off, so
  // the stacked layout hides it (CSS) — keep the buttons in sync regardless, so
  // the right one is lit when the window widens again.
  for (const b of el('viewSeg').querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.view === state.viewMode);
  }
}

// ---------- input sync ----------
function syncInputs() {
  const s = effectiveStipple();
  const set = (id: string, v: string) => {
    const n = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    // Never overwrite the field the user is actively typing into. numInput()
    // calls syncInputs() on every keystroke so OTHER fields' derived/clamped
    // values stay live — but doing that to the focused field itself fights
    // the user's own typing: type "5" of an intended "50" into height
    // (min 30, max 260), it clamps to "30" mid-keystroke, the next keystroke
    // "0" lands after it making "300", which then clamps to the max, 260.
    // numInput() re-syncs explicitly on 'change' (blur/commit), so the
    // clamped value still shows the moment the field is no longer focused.
    if (n && n !== document.activeElement) n.value = v;
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
  set('annotationText', state.annotationText);
  set('annotationX', String(state.annotationXFrac));
  set('annotationSize', String(state.annotationSizeMm));
  // Range scales with the actual can height rather than a fixed +/-40mm, so
  // "top"/"bottom" can still reach all the way to the opposite edge on a
  // tall can, and "center" spans exactly bottom-to-top either way — reported
  // as not going "high or low enough" on a can taller than ~80mm.
  const offsetEl = document.getElementById('annotationOffset') as HTMLInputElement | null;
  if (offsetEl) {
    const half = state.heightMm / 2;
    offsetEl.min = String(-half);
    offsetEl.max = String(half);
    // A shorter can can shrink the range below the current value. The range
    // input clamps what it DISPLAYS on its own, but state.annotationYOffsetMm
    // wouldn't otherwise follow — which would silently position the text
    // outside the can while the slider shows something else.
    state.annotationYOffsetMm = Math.min(half, Math.max(-half, state.annotationYOffsetMm));
  }
  set('annotationOffset', String(state.annotationYOffsetMm));
  set('ledHoleDiameter', state.ledHoleDiameterMm.toFixed(1));

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
  setText('annotationXVal', `${Math.round(state.annotationXFrac * 100)}%`);
  setText('annotationSizeVal', `${state.annotationSizeMm.toFixed(0)} mm`);
  setText('annotationOffsetVal', `${state.annotationYOffsetMm >= 0 ? '+' : ''}${state.annotationYOffsetMm.toFixed(0)} mm`);
  setText('ledHoleDiameterVal', `${state.ledHoleDiameterMm.toFixed(1)} mm`);
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
  const run = () => {
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
  };
  input.addEventListener('input', run);
  // syncInputs() deliberately skips the focused field (see its comment), so a
  // value clamped by `apply` doesn't visibly correct itself until the field
  // is no longer focused. 'change' fires on blur/commit, after focus has
  // already moved on, so this re-run is what actually shows it.
  input.addEventListener('change', run);
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

// ---------- annotation (name/date text, works on preset or custom alike) ----------
function applyAnnotationProps() {
  el('annotationProps').style.display = state.annotationText.trim() ? 'block' : 'none';
}

el<HTMLInputElement>('annotationText').addEventListener('input', (e) => {
  state.annotationText = (e.target as HTMLInputElement).value;
  applyAnnotationProps();
  draftThenFull();
});

el<HTMLInputElement>('annotationX').addEventListener('input', () => {
  state.annotationXFrac = parseFloat(el<HTMLInputElement>('annotationX').value);
  syncInputs();
  draftThenFull();
});

el<HTMLInputElement>('annotationSize').addEventListener('input', () => {
  state.annotationSizeMm = parseFloat(el<HTMLInputElement>('annotationSize').value);
  syncInputs();
  draftThenFull();
});

el<HTMLInputElement>('annotationOffset').addEventListener('input', () => {
  state.annotationYOffsetMm = parseFloat(el<HTMLInputElement>('annotationOffset').value);
  syncInputs();
  draftThenFull();
});

el('annotationAnchorSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.annotationYAnchor = (btn as HTMLElement).dataset.anchor as AnnotationAnchor;
  for (const b of el('annotationAnchorSeg').querySelectorAll('button')) b.classList.toggle('active', b === btn);
  draftThenFull();
});

// ---------- LED wire hole ----------
el('ledHoleSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.ledHoleEnabled = (btn as HTMLElement).dataset.led === 'on';
  for (const b of el('ledHoleSeg').querySelectorAll('button')) b.classList.toggle('active', b === btn);
  el('ledHoleHint').style.display = state.ledHoleEnabled ? 'block' : 'none';
  draftThenFull();
});

numInput('ledHoleDiameter', (v) => (state.ledHoleDiameterMm = v), true);

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

  // First-run guidance: with nothing placed yet the canvas is just a black
  // rectangle, which reads as broken rather than as a drop target. Say what
  // it is, right where the eye lands.
  if (state.shapes.length === 0) {
    ctx2d.save();
    ctx2d.fillStyle = 'rgba(147, 154, 165, 0.55)';
    ctx2d.font = `${Math.max(11, Math.min(15, editorCanvas.height / 9))}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('Drop a shape here to begin', editorCanvas.width / 2, editorCanvas.height / 2);
    ctx2d.restore();
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
  el<HTMLButtonElement>('deleteShape').disabled = picked.length === 0;

  // One status line carries all the just-in-time guidance that used to live in
  // a single dense hint paragraph — which message shows depends on exactly
  // what the user can do right now, so it teaches the gestures when they
  // actually apply instead of upfront. innerHTML (not setText) so <b> keeps
  // working, same as the old static hint did.
  const n = state.shapes.length;
  el('selInfo').innerHTML =
    n === 0
      ? 'No shapes yet — drag one from the palette above, or tap it to drop one in the middle.'
      : picked.length === 0
      ? `${n} shape${n === 1 ? '' : 's'} placed. Tap one to select it — <b>shift-tap</b> to select several.`
      : picked.length === 1
      ? '1 shape selected. Drag to move it, arrow keys to nudge, <b>Delete</b> to remove it.'
      : `${picked.length} of ${n} selected. Align or arrange them below, or <b>Delete</b> to remove them together.`;
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
    b.title = `${def.name} — drag onto the canvas, or tap to place it`;
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
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cleanup);
      btn.classList.remove('dragging');
      ghost.remove();
    };
    const up = (ev: PointerEvent) => {
      cleanup();
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
      renderEditor();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cleanup);
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

// ---------- responsive control panels ----------
// The panels are <details> so a phone doesn't get one endless scroll wall.
// Wide layout: force every panel open, so they behave exactly like the plain
// sections they replaced (the CSS also makes their headings inert there).
// Narrow layout: only the panels marked data-mobile="open" start expanded.
{
  const stacked = window.matchMedia(STACKED_QUERY);
  const panels = document.querySelectorAll<HTMLDetailsElement>('details.ctrl');
  const applyPanelDefaults = () => {
    for (const d of panels) d.open = stacked.matches ? d.dataset.mobile === 'open' : true;
  };
  applyPanelDefaults();
  stacked.addEventListener('change', () => {
    applyPanelDefaults();
    // Crossing the breakpoint flips whether the flat pane exists at all
    // (effectiveViewMode), so the panes and the 3D can's height both need
    // recomputing — and the flat raster has to be built if it just came back.
    applyViewMode();
    // ...and the crop rail has to move back to whichever pane it annotates,
    // with the wording that matches (renderCropRail -> placeCropRail).
    renderCropRail();
    renderPreviews();
  });
}

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
applyAnnotationProps();
syncInputs();
regenerate(PPM_FULL);
(window as any).__state = state;
(window as any).__getResult = () => result;
(window as any).__renderEditor = renderEditor;
