#!/usr/bin/env python3
# "MANGO SALVAJE" - 360 deg seamless stipple wrap for a 500 ml can
# Generates laser-ready SVG (holes) + previews.

import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ---------------- canvas ----------------
CAN_D = 65.0                      # can body diameter [mm]  -> measure yours!
W = math.pi * CAN_D               # unwrapped circumference
H = 142.0                         # straight cylindrical wall, edge to edge
PPM = 8                           # raster px per mm
Wp, Hp = int(round(W*PPM)), int(round(H*PPM))
CANV = 3*Wp                       # 3 tiles for seamless wrap

rng = np.random.default_rng(7)

def newmask():
    return Image.new("L", (CANV, Hp), 0)

def P(x, y):
    """mm (x right, y up from bottom) -> px in 3-tile canvas"""
    return ((x + W)*PPM, (H - y)*PPM)

def fold(img):
    a = np.asarray(img, dtype=np.float32)/255.0
    return np.maximum.reduce([a[:, :Wp], a[:, Wp:2*Wp], a[:, 2*Wp:]])

# ---------------- shape helpers ----------------
def thickline(d, pts, w_mm, fill=255):
    px = [P(*p) for p in pts]
    d.line(px, fill=fill, width=max(1, int(round(w_mm*PPM))), joint="curve")

def poly(d, pts, fill=255):
    d.polygon([P(*p) for p in pts], fill=fill)

def ell(d, cx, cy, rx, ry, fill=255):
    x0, y0 = P(cx-rx, cy+ry); x1, y1 = P(cx+rx, cy-ry)
    d.ellipse([x0, y0, x1, y1], fill=fill)

def taper(d, base, tip, w, bend=0.0, fill=255):
    """tapered blade from base to tip, slight sideways bend"""
    bx, by = base; tx, ty = tip
    ax, ay = tx-bx, ty-by
    L = math.hypot(ax, ay) or 1e-6
    nx, ny = -ay/L, ax/L
    mx, my = (bx+tx)/2 + nx*bend, (by+ty)/2 + ny*bend
    pts = [(bx+nx*w/2, by+ny*w/2),
           (mx+nx*w*0.30, my+ny*w*0.30),
           (tx, ty),
           (mx-nx*w*0.30, my-ny*w*0.30),
           (bx-nx*w/2, by-ny*w/2)]
    poly(d, pts, fill)

def frond(d, x0, y0, L, ang0, curve, nleaf=16, lmax=9.0, lw=2.0, fill=255):
    x, y, ang = x0, y0, math.radians(ang0)
    step = L/59.0
    spine = [(x, y)]
    for i in range(59):
        ang += math.radians(curve)/59.0
        x += step*math.cos(ang); y += step*math.sin(ang)
        spine.append((x, y))
    thickline(d, spine, 1.5, fill)
    for k in range(nleaf):
        t = 0.10 + 0.88*k/(nleaf-1)
        i = int(t*59)
        px, py = spine[i]
        qx, qy = spine[min(i+1, 59)]
        a = math.atan2(qy-py, qx-px)
        ln = lmax*(math.sin(math.pi*min(t*1.05, 1.0))**0.55)
        spread = math.radians(62 - 26*t)
        for s in (+1, -1):
            aa = a + s*spread
            tip = (px + ln*math.cos(aa), py + ln*math.sin(aa))
            taper(d, (px, py), tip, lw, bend=s*ln*0.14, fill=fill)

def monstera(d, cx, cy, R, rot=0.0, fill=255):
    ro = math.radians(rot)
    def T(u, v):
        return (cx + u*math.cos(ro) - v*math.sin(ro),
                cy + u*math.sin(ro) + v*math.cos(ro))
    pts = []
    for i in range(180):
        th = 2*math.pi*i/180
        r = R*(0.86 + 0.20*math.cos(th) - 0.10*math.cos(2*th))
        pts.append(T(r*math.cos(th)*0.92, r*math.sin(th)))
    poly(d, pts, fill)
    thickline(d, [T(0, -R*1.05), T(0.0, R*0.05)], 1.6, fill)
    # notches
    for s in (+1, -1):
        for k in range(4):
            v = -R*0.62 + k*R*0.42
            u_out = s*R*1.25
            w = R*0.16
            poly(d, [T(u_out, v-w), T(s*R*0.12, v-w*0.35),
                     T(s*R*0.12, v+w*0.35), T(u_out, v+w)], 0)
    ell(d, *T(0, 0), R*0.055, R*0.055, 0)

def agave(d, x0, y0, h, n=9, spread=76, w=3.0, fill=255):
    for k in range(n):
        f = (k/(n-1))*2-1
        a = math.radians(90 + f*spread)
        ln = h*(0.55 + 0.45*math.cos(f*1.35))
        tip = (x0 + ln*math.cos(a), y0 + ln*math.sin(a))
        taper(d, (x0, y0), tip, w, bend=f*ln*0.10, fill=fill)

def mango_branch(d, x0, y0, sc=1.0, fill=255):
    L = 36*sc
    spine = [(x0 + 4.0*sc*math.sin(2.4*i/34), y0 + L*i/34) for i in range(35)]
    thickline(d, spine, 1.5*sc, fill)
    for t, a, ln in ((0.52, 34, 13), (0.70, 148, 12), (0.88, 42, 11), (0.97, 132, 10)):
        px, py = spine[int(t*34)]
        ar = math.radians(a)
        taper(d, (px, py), (px + ln*sc*math.cos(ar), py + ln*sc*math.sin(ar)),
              3.6*sc, bend=1.6*sc, fill=fill)
    for t, side, ped in ((0.58, -1, 8), (0.72, 1, 10), (0.86, -1, 7)):
        px, py = spine[int(t*34)]
        ex, ey = px + side*3.0*sc, py - ped*sc
        thickline(d, [(px, py), (ex, ey)], 0.7*sc, fill)
        mango(d, ex + side*1.2*sc, ey - 4.2*sc, 11.0*sc, rot=-78 + side*16,
              stem=False, fill=fill)


def grass(d, x0, y0, h, n=7, fill=255):
    for k in range(n):
        f = (k/(n-1))*2-1
        a = math.radians(90 + f*46)
        ln = h*(0.6+0.4*random.random())
        taper(d, (x0, y0), (x0+ln*math.cos(a), y0+ln*math.sin(a)), 1.1,
              bend=f*ln*0.22, fill=fill)

def mango(d, cx, cy, L, rot=0.0, stem=True, fill=255):
    ro = math.radians(rot)
    def T(u, v):
        return (cx + u*math.cos(ro) - v*math.sin(ro), cy + u*math.sin(ro) + v*math.cos(ro))
    pts = []
    for i in range(220):
        th = 2*math.pi*i/220
        rr = 1.0 + 0.17*math.cos(th) - 0.08*math.cos(2*th) + 0.06*math.sin(th)
        pts.append(T(0.5*L*rr*math.cos(th), 0.5*L*0.64*rr*math.sin(th)))
    poly(d, pts, fill)
    if stem:
        thickline(d, [T(-0.44*L, 0.16*L), T(-0.60*L, 0.30*L)], 0.09*L, fill)
        taper(d, T(-0.56*L, 0.26*L), T(-0.86*L, 0.44*L), 0.20*L, bend=0.05*L, fill=fill)


def blade(d, x0, y0, L, ang, bend, w, slits=6, fill=255):
    a = math.radians(ang)
    tip = (x0 + L*math.cos(a), y0 + L*math.sin(a))
    taper(d, (x0, y0), tip, w, bend=bend, fill=fill)
    nx, ny = -math.sin(a), math.cos(a)
    for k in range(slits):
        t = 0.22 + 0.70*k/(slits-1)
        px, py = x0 + L*t*math.cos(a), y0 + L*t*math.sin(a)
        sg = 1 if k % 2 else -1
        ww = w*0.55*math.sin(math.pi*t)
        d.line([P(px+nx*sg*ww*0.15, py+ny*sg*ww*0.15),
                P(px+nx*sg*ww*1.5 + math.cos(a)*2.0, py+ny*sg*ww*1.5 + math.sin(a)*2.0)],
               fill=0, width=max(1, int(0.9*PPM)))


def bird(d, cx, cy, s, fill=255):
    shape = [(-1.00, 0.02), (-0.62, 0.30), (-0.30, 0.16), (-0.10, 0.30),
             (0.00, 0.10), (0.10, 0.30), (0.30, 0.16), (0.62, 0.30),
             (1.00, 0.02), (0.55, 0.06), (0.00, -0.10), (-0.55, 0.06)]
    poly(d, [(cx+u*s, cy+v*s) for u, v in shape], fill)

def greca(d, ybase, band, reps=16, fill=255):
    """stepped-fret ribbon, seamless"""
    u = W/reps
    for k in range(reps):
        x = k*u
        st = band/3.0
        for i, (a, b) in enumerate(((0.10, 0.90), (0.24, 0.76), (0.38, 0.62))):
            poly(d, [(x+a*u, ybase+i*st), (x+b*u, ybase+i*st),
                     (x+b*u, ybase+(i+1)*st), (x+a*u, ybase+(i+1)*st)], fill)
        poly(d, [(x+0.945*u, ybase), (x+1.055*u, ybase),
                 (x+1.055*u, ybase+st*0.55), (x+0.945*u, ybase+st*0.55)], fill)

# ---------------- build the field ----------------
# One full revolution = one full day: dawn -> day -> dusk -> night -> dawn.
X = (np.arange(Wp)+0.5)/PPM
Y = H - (np.arange(Hp)+0.5)/PPM
XX, YY = np.meshgrid(X, Y)

def dx(cx):
    return (XX-cx + W/2) % W - W/2

SUNX, SUNY = 52.0, 70.0
GROUND, SKYTOP = 15.5, 132.8
day = np.exp(-(dx(SUNX)/62.0)**2)

F = np.full_like(XX, 0.035)
F = np.maximum(F, (0.10 + 0.90*day)*np.exp(-np.clip(YY-36.0, 0, None)/(14.0+12.0*day)))

for hb, amp, sig, n1 in ((92, 0.24, 2.6, 2), (112, 0.18, 2.2, 3)):
    off = 7.0*np.sin(2*np.pi*n1*XX/W + hb)
    F += amp*day*np.exp(-((YY-hb-off)/sig)**2)

def disc(cx, cy, rx, ry):
    u = dx(cx)/rx; v = (YY-cy)/ry
    return np.sqrt(u*u+v*v), np.arctan2(v, u), u, v

# --- radiant sun ---
r, th, u, v = disc(SUNX, SUNY, 31.0, 29.0)
fib = 0.5 + 0.5*np.cos(16*th)
sun = np.where((r <= 1.0) & ((fib < 0.82) | (r < 0.30)), 1.0, 0.0)
rayw = np.clip(1.0 - (r-1.18)/0.62, 0, 1)
raysd = (r > 1.18) & (r < 1.80)
sun = np.maximum(sun, np.where(raysd & (fib < 0.38), 0.30+0.70*rayw, 0.0))
ramp = np.clip((YY-44.0)/18.0, 0, 1)
gap = np.where(raysd & (fib >= 0.38), ramp, 0.0)
gap = np.maximum(gap, np.where((r > 1.0) & (r < 1.18), 1.0, 0.0))
F = np.maximum(F, sun)*(1.0-0.97*gap)

# --- crescent moon ---
r1, _, _, _ = disc(165.0, 99.0, 14.5, 14.5)
r2, _, _, _ = disc(169.8, 102.4, 12.7, 12.7)
F = np.maximum(F, np.where((r1 <= 1.0) & (r2 > 1.0), 0.95, 0.0))

# --- night sky: milky way band + scattered stars ---
def night(sx):
    return float(np.exp(-(((sx-SUNX+W/2) % W - W/2)/62.0)**2)) < 0.32

mw = lambda xx: 96.0 + 15.0*np.sin(2*np.pi*1.5*xx/W + 0.8)
placed = 0
while placed < 150:
    sx = rng.uniform(0, W)
    sy = float(mw(np.array(sx))) + rng.normal(0, 7.0)
    if not (GROUND+6 < sy < SKYTOP-6) or not night(sx):
        continue
    F = np.maximum(F, np.exp(-(dx(sx)**2 + (YY-sy)**2)/0.42))
    placed += 1
placed = 0
while placed < 90:
    sx = rng.uniform(0, W); sy = rng.uniform(GROUND+20, SKYTOP-5)
    if not night(sx):
        continue
    F = np.maximum(F, np.exp(-(dx(sx)**2 + (YY-sy)**2)/0.55))
    placed += 1

F = np.clip(F, 0, 1)

# --- decorative borders ---
bi = newmask(); bd = ImageDraw.Draw(bi)
greca(bd, 2.0, 4.6, reps=16)
for xk in range(24):
    cx = (xk+0.5)*W/24
    poly(bd, [(cx, 135.4), (cx+2.5, 137.9), (cx, 140.4), (cx-2.5, 137.9)], 255)
for yb in (7.8, 133.6):
    poly(bd, [(-W, yb), (2*W, yb), (2*W, yb+0.9), (-W, yb+0.9)], 255)
poly(bd, [(-W, 141.1), (2*W, 141.1), (2*W, H), (-W, H)], 255)
bird(bd, 116.0, 86.0, 9.0)
bird(bd, 131.0, 99.0, 6.0)
bird(bd, 124.0, 114.0, 4.6)
bird(bd, 189.0, 108.0, 6.5)
border = fold(bi)

F = np.where(YY < 9.6, 0.0, F)
F = np.where(YY > SKYTOP, 0.0, F)
F = np.maximum(F, border)

# --- jungle silhouette ---
random.seed(11)
si = newmask(); sd = ImageDraw.Draw(si)
poly(sd, [(-W, 9.6), (2*W, 9.6), (2*W, GROUND), (-W, GROUND)], 255)

frond(sd, 1.0, 15.0, 40, 78, -48, nleaf=14, lmax=14.0, lw=3.6)
monstera(sd, 17.0, 30.0, 16.0, rot=-22)
agave(sd, 37.0, 14.5, 29, n=10, spread=64, w=4.8)
mango_branch(sd, 68.0, 14.5, sc=1.30)
monstera(sd, 89.0, 28.0, 15.5, rot=16)
frond(sd, 105.0, 15.0, 48, 80, -46, nleaf=14, lmax=16.0, lw=3.8)
agave(sd, 121.0, 14.5, 37, n=10, spread=76, w=5.0)
mango_branch(sd, 134.0, 14.5, sc=1.20)
blade(sd, 146.0, 15.0, 42, 108, 6.5, 15.0, slits=7)
monstera(sd, 158.0, 32.0, 17.0, rot=12)
blade(sd, 170.0, 15.0, 39, 72, -6.0, 13.5, slits=6)
agave(sd, 191.0, 14.5, 43, n=10, spread=82, w=5.4)
blade(sd, 203.0, 15.0, 36, 100, 5.0, 13.0, slits=6)
for gx in (27, 58, 84, 100, 180):
    grass(sd, gx+random.uniform(-2, 2), 14.5, random.uniform(8, 13))

sil_img = Image.fromarray((fold(si)*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
sil = np.asarray(sil_img, np.float32)/255.0
rim = np.clip(np.asarray(sil_img.filter(ImageFilter.MaxFilter(15)), np.float32)/255.0 - sil, 0, 1)
rim *= np.clip((0.55-day)/0.30, 0, 1)*np.where((YY > 9.2) & (YY < SKYTOP+0.2), 1.0, 0.0)
F = np.maximum(F, 0.95*rim)
F = F*(1.0-sil)
F = np.clip(F, 0, 1)

# ---------------- stipple ----------------
PITCH = 1.45
ncols = int(round(W/PITCH)); p = W/ncols
rowsp = p*math.sqrt(3)/2
nrows = int(round(H/rowsp))
JIT = 0.15
D_MIN, D_MAX = 0.28, 0.52
THRESH = 0.13

holes_var, holes_uni = [], []
r2 = np.random.default_rng(3)
for j in range(nrows):
    y = (j+0.5)*rowsp
    for i in range(ncols):
        x = (i + (0.5 if j % 2 else 0.0))*p + p*0.5
        x += (r2.random()-0.5)*2*JIT*p
        y2 = y + (r2.random()-0.5)*2*JIT*rowsp
        xw = x % W
        if not (0.3 < y2 < H-0.3):
            continue
        px = min(Wp-1, max(0, int(xw*PPM)))
        py = min(Hp-1, max(0, int((H-y2)*PPM)))
        f = float(F[py, px])
        if f <= THRESH:
            continue
        g = (f-THRESH)/(1-THRESH)
        holes_var.append((xw, H-y2, (D_MIN + (D_MAX-D_MIN)*g**0.85)/2))
        t = (52.9829189*((0.06711056*i + 0.00583715*j) % 1.0)) % 1.0
        if f > 0.78 or f > 0.04 + 0.84*t:
            holes_uni.append((xw, H-y2, 0.35/2))

print(f"canvas {W:.2f} x {H} mm | pitch {p:.3f} | variable {len(holes_var)} | uniform {len(holes_uni)}")

def write_svg(path, holes, title):
    out = [f'<?xml version="1.0" encoding="UTF-8"?>',
           f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.3f}mm" height="{H:.3f}mm" '
           f'viewBox="0 0 {W:.3f} {H:.3f}">',
           f'<title>{title}</title>',
           f'<g id="holes" fill="#000000" stroke="none">']
    for x, y, r in holes:
        out.append(f'<circle cx="{x:.3f}" cy="{y:.3f}" r="{r:.3f}"/>')
    out += ['</g>', '</svg>']
    open(path, "w").write("\n".join(out))

write_svg("/home/claude/out/mango_salvaje_variabel.svg", holes_var, "Mango Salvaje - variable dot")
write_svg("/home/claude/out/mango_salvaje_uniform.svg", holes_uni, "Mango Salvaje - uniform 0.35mm")

# ---------------- previews ----------------
SP = 7
def render(holes, w=W, h=H):
    im = Image.new("L", (int(w*SP), int(h*SP)), 0)
    d = ImageDraw.Draw(im)
    for x, y, r in holes:
        rp = max(1.0, r*SP)
        d.ellipse([ (x-r)*SP, (y-r)*SP, (x+r)*SP, (y+r)*SP ], fill=255)
    return im

def glow(im):
    a = np.asarray(im, np.float32)/255
    b1 = np.asarray(im.filter(ImageFilter.GaussianBlur(1.6)), np.float32)/255
    b2 = np.asarray(im.filter(ImageFilter.GaussianBlur(9.0)), np.float32)/255
    b3 = np.asarray(im.filter(ImageFilter.GaussianBlur(30.0)), np.float32)/255
    L = np.clip(a*1.0 + b1*0.75 + b2*0.85 + b3*1.5, 0, 1.6)
    R = np.clip(L*1.30, 0, 1)**0.80
    G = np.clip(L*0.86, 0, 1)**1.02
    B = np.clip(L*0.42, 0, 1)**1.45
    rgb = np.stack([R, G, B], -1)
    rgb = rgb*0.97 + 0.03*np.stack([np.full_like(L, 0.06), np.full_like(L, 0.05), np.full_like(L, 0.06)], -1)
    return (np.clip(rgb, 0, 1)*255).astype(np.uint8)

flat = glow(render(holes_var))
Image.fromarray(flat).save("/home/claude/out/preview_flat.png")
flat_u = glow(render(holes_uni))
Image.fromarray(flat_u).save("/home/claude/out/preview_flat_uniform.png")

# cylinder mock-ups: sun side + moon side
def cylinder(flat_rgb, turns):
    hpix, wpix, _ = flat_rgb.shape
    R = wpix/(2*math.pi); outw = int(2*R)
    xs = np.clip((np.arange(outw)+0.5 - R)/R, -0.99999, 0.99999)
    th = np.arcsin(xs)
    u = ((th/(2*math.pi))*wpix + turns*wpix) % wpix
    cols = flat_rgb[:, u.astype(int), :].astype(np.float32)
    cols *= (0.22 + 0.78*np.cos(th)**0.5)[None, :, None]
    return np.clip(cols, 0, 255).astype(np.uint8)

SC = flat.shape[0]/H                      # px per mm on the mock-up
CAN_H, BAND_Y = 168.0, 13.0
def can_render(turns):
    band = cylinder(flat, turns)
    bh, bw, _ = band.shape
    ch = int(CAN_H*SC)
    im = np.zeros((ch, bw, 3), np.float32)
    xs = np.clip((np.arange(bw)+0.5 - bw/2)/(bw/2), -1, 1)
    shade = (0.10 + 0.30*np.sqrt(np.clip(1-xs**2, 0, 1)))[None, :, None]
    im[:] = shade*np.array([132, 128, 126])
    top = ch - int((BAND_Y+H)*SC)
    im[top:top+bh] = np.maximum(im[top:top+bh]*0.25, band.astype(np.float32))
    img = Image.fromarray(np.clip(im, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for yy, col in ((0, (150, 148, 146)), (ch-int(5*SC), (70, 68, 68))):
        d.ellipse([0, yy-int(3.5*SC), bw, yy+int(3.5*SC)], fill=col)
    d.rectangle([0, 0, bw-1, int(2*SC)], fill=(120, 118, 116))
    return img

gap = int(24*SC)
sunc, moonc = can_render(52.0/W), can_render(165.0/W)
Wtot = sunc.width*2 + gap + 2*gap
Htot = sunc.height + 2*gap
sheet = Image.new("RGB", (Wtot, Htot), (10, 9, 11))
sheet.paste(sunc, (gap, gap)); sheet.paste(moonc, (gap*2 + sunc.width, gap))
sheet.filter(ImageFilter.GaussianBlur(0.3)).save("/home/claude/out/preview_can.png")
print("done")
