// A real 3D can mockup built from CSS 3D transforms: the flat wrap texture
// is sliced into narrow vertical strip <canvas> elements, each placed on the
// rim of an actual cylinder via rotateY + translateZ. The browser's own 3D
// pipeline then handles the foreshortening/perspective correctly — no fake
// arcsin projection needed, which is what the old 2D pseudo-cylinder did.
//
// Can "styles" here are generic colorways (body + cap color only) rather than
// a specific brand's logo/trade dress — see CLAUDE.md: presets are original
// designs, the can is just the substrate. A real product's wordmark/claw mark
// is also trademarked, so it's left out on both grounds.
export interface CanStyle {
  id: string;
  name: string;
  body: string;
  bodyShade: string;
  cap: string;
}

export const CAN_STYLES: CanStyle[] = [
  { id: 'blackout', name: 'Blackout', body: '#111214', bodyShade: '#000000', cap: '#2c2d30' },
  { id: 'arctic', name: 'Arctic White', body: '#eef1f3', bodyShade: '#aeb4b8', cap: '#c9ced1' },
  { id: 'citrus', name: 'Citrus Green', body: '#173a16', bodyShade: '#081a08', cap: '#2c4d29' },
  { id: 'sunrise', name: 'Sunrise Pink', body: '#7d2447', bodyShade: '#3c1122', cap: '#5c1a34' },
  { id: 'aluminum', name: 'Brushed Aluminum', body: '#a29e99', bodyShade: '#615e5a', cap: '#87837f' },
];

const STRIPS = 64;
const TILT_DEG = -10;

export interface Can3D {
  stage: HTMLDivElement;
  setRotationDeg(deg: number): void;
  getRotationDeg(): number;
  update(opts: {
    texture: HTMLCanvasElement;
    lit: boolean;
    style: CanStyle;
    diameterMm: number;
    heightMm: number;
    /** cap the stage so the can fits the space actually on screen */
    maxHeightPx?: number;
  }): void;
}

export function createCan3D(mount: HTMLElement): Can3D {
  mount.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'can3d-stage';

  const cylinder = document.createElement('div');
  cylinder.className = 'can3d-cylinder';
  stage.appendChild(cylinder);

  const strips: HTMLCanvasElement[] = [];
  for (let i = 0; i < STRIPS; i++) {
    const c = document.createElement('canvas');
    c.className = 'can3d-strip';
    cylinder.appendChild(c);
    strips.push(c);
  }

  const topCap = document.createElement('div');
  topCap.className = 'can3d-cap can3d-cap-top';
  const botCap = document.createElement('div');
  botCap.className = 'can3d-cap can3d-cap-bot';
  cylinder.appendChild(topCap);
  cylinder.appendChild(botCap);

  const shade = document.createElement('div');
  shade.className = 'can3d-shade';
  stage.appendChild(shade);

  mount.appendChild(stage);

  let rotationDeg = 0;

  function applyRotation() {
    cylinder.style.transform = `rotateX(${TILT_DEG}deg) rotateY(${rotationDeg}deg)`;
  }
  applyRotation();

  // drag to rotate
  let dragStartX = 0;
  let dragStartRot = 0;
  let dragging = false;
  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartRot = rotationDeg;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rotationDeg = dragStartRot + (e.clientX - dragStartX) * 0.5;
    applyRotation();
    stage.dispatchEvent(new CustomEvent('can3d-rotate', { detail: rotationDeg }));
  });
  const endDrag = () => {
    dragging = false;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  function update(opts: {
    texture: HTMLCanvasElement;
    lit: boolean;
    style: CanStyle;
    diameterMm: number;
    heightMm: number;
    /** cap the stage so the can fits the space actually on screen */
    maxHeightPx?: number;
  }) {
    const { texture, lit, style, diameterMm, heightMm } = opts;
    const stageW = Math.max(240, mount.clientWidth || 360);
    const stageH = Math.min(opts.maxHeightPx ?? 560, Math.max(260, stageW * 1.15));
    stage.style.width = `${stageW}px`;
    stage.style.height = `${stageH}px`;

    // fit the can within the stage with headroom for the tilt + caps
    const scale = Math.min((stageH * 0.82) / heightMm, (stageW * 0.34) / diameterMm);
    const heightPx = heightMm * scale;
    const radiusPx = (diameterMm * scale) / 2;

    cylinder.style.width = '0px';
    cylinder.style.height = '0px';
    cylinder.style.left = `${stageW / 2}px`;
    cylinder.style.top = `${stageH / 2}px`;

    const stripAngle = 360 / STRIPS;
    const stripWpx = Math.max(2, Math.ceil((2 * Math.PI * radiusPx) / STRIPS) + 1);
    const texW = texture.width;
    const texH = texture.height;
    const sliceW = texW / STRIPS;

    strips.forEach((canvas, i) => {
      canvas.width = stripWpx;
      canvas.height = Math.round(heightPx);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = style.body;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = lit ? 'lighten' : 'source-over';
      ctx.drawImage(texture, i * sliceW, 0, sliceW, texH, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      // subtle vertical shading per strip based on its facing, for roundness
      const facing = Math.cos(((i + 0.5) * stripAngle * Math.PI) / 180);
      const dark = Math.max(0, -facing) * 0.5;
      if (dark > 0.02) {
        ctx.fillStyle = `rgba(0,0,0,${dark})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const angle = i * stripAngle;
      canvas.style.width = `${stripWpx}px`;
      canvas.style.height = `${heightPx}px`;
      canvas.style.transform = `translate(-50%, -50%) rotateY(${angle}deg) translateZ(${radiusPx}px)`;
    });

    for (const cap of [topCap, botCap]) {
      cap.style.width = `${radiusPx * 2}px`;
      cap.style.height = `${radiusPx * 2}px`;
      cap.style.background = `radial-gradient(circle at 38% 38%, ${style.cap}, ${style.bodyShade})`;
    }
    topCap.style.transform = `translate(-50%, -50%) rotateX(90deg) translateZ(${heightPx / 2}px)`;
    botCap.style.transform = `translate(-50%, -50%) rotateX(90deg) translateZ(${-heightPx / 2}px)`;
  }

  return {
    stage,
    setRotationDeg(deg: number) {
      rotationDeg = deg;
      applyRotation();
    },
    getRotationDeg() {
      return rotationDeg;
    },
    update,
  };
}
