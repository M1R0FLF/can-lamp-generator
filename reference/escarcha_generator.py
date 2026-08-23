#!/usr/bin/env python3
# "ESCARCHA" - 360 deg seamless frost/ice wrap, twin of Mango Salvaje.
# Bigger motifs, finer grid, dense crack network -> busy but legible.

import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

CAN_D = 65.0
W = math.pi * CAN_D
H = 142.0
PPM = 8
Wp, Hp = int(round(W*PPM)), int(round(H*PPM))
CANV = 3*Wp
rng = np.random.default_rng(21)

def newmask():
    return Image.new("L", (CANV, Hp), 0)

def P(x, y):
    return ((x + W)*PPM, (H - y)*PPM)

def fold(img):
    a = np.asarray(img, dtype=np.float32)/255.0
    return np.maximum.reduce([a[:, :Wp], a[:, Wp:2*Wp], a[:, 2*Wp:]])

def dil(mask, px):
    im = Image.fromarray((mask*255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.MaxFilter(px)), np.float32)/255.0

# ---------------- primitives ----------------
def thickline(d, pts, w_mm, fill=255):
    d.line([P(*p) for p in pts], fill=fill,
           width=max(1, int(round(w_mm*PPM))), joint="curve")

def poly(d, pts, fill=255):
    d.polygon([P(*p) for p in pts], fill=fill)

def taper(d, base, tip, w0, w1, fill=255):
    bx, by = base; tx, ty = tip
    ax, ay = tx-bx, ty-by
    L = math.hypot(ax, ay) or 1e-6
    nx, ny = -ay/L, ax/L
    poly(d, [(bx+nx*w0/2, by+ny*w0/2), (tx+nx*w1/2, ty+ny*w1/2),
             (tx-nx*w1/2, ty-ny*w1/2), (bx-nx*w0/2, by-ny*w0/2)], fill)

def hexagon(d, cx, cy, R, rot=0.0, fill=255):
    poly(d, [(cx+R*math.cos(math.radians(rot+60*k)),
              cy+R*math.sin(math.radians(rot+60*k))) for k in range(6)], fill)

def hexring(d, cx, cy, R, rot, w, fill=255):
    pts = [(cx+R*math.cos(math.radians(rot+60*k)),
            cy+R*math.sin(math.radians(rot+60*k))) for k in range(6)]
    thickline(d, pts+[pts[0]], w, fill)

# ---------------- crystals ----------------
def dendrite(d, cx, cy, R, rot=90.0, fill=255):
    """stellar dendrite: 6 arms, side branches, sub-branches"""
    hexagon(d, cx, cy, R*0.13, rot, fill)
    hexring(d, cx, cy, R*0.26, rot, 2.8, fill)
    for k in range(6):
        a = math.radians(rot + 60*k)
        ca, sa = math.cos(a), math.sin(a)
        taper(d, (cx, cy), (cx+R*ca, cy+R*sa), 5.0, 2.4, fill)
        for t in (0.34, 0.52, 0.70, 0.86):
            px, py = cx+R*t*ca, cy+R*t*sa
            bl = R*(0.36*(1.0-t)**0.70 + 0.045)
            for s in (1, -1):
                ba = a + s*math.radians(60)
                bx, by = px+bl*math.cos(ba), py+bl*math.sin(ba)
                taper(d, (px, py), (bx, by), 3.0, 2.2, fill)
                if t < 0.60 and bl > 9.0:
                    qx, qy = px+bl*0.60*math.cos(ba), py+bl*0.60*math.sin(ba)
                    sl = bl*0.34
                    for s2 in (1, -1):
                        sb = ba + s2*math.radians(60)
                        taper(d, (qx, qy),
                              (qx+sl*math.cos(sb), qy+sl*math.sin(sb)), 2.4, 2.1, fill)
        hexagon(d, cx+R*0.985*ca, cy+R*0.985*sa, R*0.085, rot, fill)

def star_flake(d, cx, cy, R, rot=90.0, fill=255):
    """chunky solid six-point snow star with dark detail cuts"""
    hexagon(d, cx, cy, R*0.34, rot, fill)
    for k in range(6):
        a = math.radians(rot + 60*k)
        ca, sa = math.cos(a), math.sin(a)
        taper(d, (cx+R*0.05*ca, cy+R*0.05*sa), (cx+R*ca, cy+R*sa), R*0.27, R*0.11, fill)
        for t, ln, w in ((0.40, 0.34, 0.17), (0.62, 0.25, 0.13), (0.82, 0.15, 0.10)):
            px, py = cx+R*t*ca, cy+R*t*sa
            for sg in (1, -1):
                ba = a + sg*math.radians(60)
                taper(d, (px, py), (px+R*ln*math.cos(ba), py+R*ln*math.sin(ba)),
                      R*w, R*w*0.55, fill)
        hexagon(d, cx+R*0.99*ca, cy+R*0.99*sa, R*0.105, rot, fill)
    for k in range(6):
        a = math.radians(rot + 60*k)
        thickline(d, [(cx+R*0.10*math.cos(a), cy+R*0.10*math.sin(a)),
                      (cx+R*0.94*math.cos(a), cy+R*0.94*math.sin(a))], R*0.036, 0)
        a2 = math.radians(rot + 60*k)
        for t, ln in ((0.40, 0.30), (0.62, 0.21)):
            px, py = cx+R*t*math.cos(a2), cy+R*t*math.sin(a2)
            for sg in (1, -1):
                ba = a2 + sg*math.radians(60)
                thickline(d, [(px, py), (px+R*ln*math.cos(ba), py+R*ln*math.sin(ba))],
                          R*0.032, 0)
    hexring(d, cx, cy, R*0.215, rot, R*0.032, 0)
    hexring(d, cx, cy, R*0.46, rot, R*0.030, 0)


def plate(d, cx, cy, R, rot=90.0, fill=255):
    """sectored hexagonal plate"""
    for rr, w in ((1.0, 3.6), (0.74, 3.0), (0.48, 2.6)):
        hexring(d, cx, cy, R*rr, rot, w, fill)
    hexagon(d, cx, cy, R*0.20, rot, fill)
    for k in range(6):
        a = math.radians(rot + 60*k)
        taper(d, (cx, cy), (cx+R*math.cos(a), cy+R*math.sin(a)), 3.4, 2.6, fill)
        a2 = math.radians(rot + 30 + 60*k)
        taper(d, (cx+R*0.20*math.cos(a2), cy+R*0.20*math.sin(a2)),
              (cx+R*0.87*math.cos(a2), cy+R*0.87*math.sin(a2)), 2.8, 2.2, fill)
        hexagon(d, cx+R*math.cos(a), cy+R*math.sin(a), R*0.10, rot, fill)

def fern(d, x0, y0, ang, L, w, depth, fill=255, rnd=None):
    """recursive frost fern - many short barbs = feathery"""
    a = math.radians(ang)
    tx, ty = x0 + L*math.cos(a), y0 + L*math.sin(a)
    taper(d, (x0, y0), (tx, ty), w, max(w*0.55, 1.9), fill)
    if depth <= 0:
        return
    n = 6 if depth >= 2 else 4
    for i in range(n):
        t = 0.16 + 0.78*i/(n-1)
        px, py = x0 + L*t*math.cos(a), y0 + L*t*math.sin(a)
        bl = L*(0.34*(1.0-t)**0.85 + 0.055)
        if bl < 3.2:
            continue
        for s in (1, -1):
            j = rnd.uniform(-7, 7) if rnd else 0.0
            fern(d, px, py, ang + s*58 + j, bl, max(w*0.60, 2.0),
                 depth-1, fill, rnd)


# ---------------- crack network (wrapped Voronoi) ----------------
def crack_field(nseed=460, wid_lo=0.95, wid_hi=1.35):
    xs, ys = [], []
    r = np.random.default_rng(5)
    while len(xs) < nseed:
        x = r.uniform(0, W); y = r.uniform(6.0, H-4.0)
        # denser (smaller cells) low down and on the shattered side
        dens = 0.34 + 0.62*np.exp(-((y-14.0)/62.0)**2) \
               + 0.50*np.exp(-(((x-150.0+W/2) % W - W/2)/48.0)**2)
        if r.random() < dens/1.4:
            xs.append(x); ys.append(y)
    xs = np.array(xs); ys = np.array(ys)

    X = (np.arange(Wp)+0.5)/PPM
    Y = H - (np.arange(Hp)+0.5)/PPM
    XX, YY = np.meshgrid(X.astype(np.float32), Y.astype(np.float32))
    d1 = np.full_like(XX, 1e9); d2 = np.full_like(XX, 1e9)
    for sx, sy in zip(xs, ys):
        dxw = np.abs(XX - sx); dxw = np.minimum(dxw, W - dxw)
        dd = np.hypot(dxw, YY - sy)
        m = dd < d1
        d2 = np.where(m, d1, np.minimum(d2, dd))
        d1 = np.where(m, dd, d1)
    wid = wid_lo + (wid_hi-wid_lo)*np.clip(1.0 - (YY-10.0)/110.0, 0, 1)
    return np.clip(1.0 - (d2-d1)/wid, 0, 1)

# ---------------- build the field ----------------
X = (np.arange(Wp)+0.5)/PPM
Y = H - (np.arange(Hp)+0.5)/PPM
XX, YY = np.meshgrid(X, Y)

def dx(cx):
    return (XX-cx + W/2) % W - W/2

HERO = (52.0, 78.0, 51.0)
SKYTOP, FLOOR = 132.6, 10.4

print("cracks...")
cracks = crack_field()

# crack brightness follows a broad glow around the hero crystal
glow = np.exp(-(np.hypot(dx(HERO[0])*0.85, (YY-HERO[1])*0.85)/86.0)**2)
F = cracks*(0.125 + 0.16*glow)

# faint frost haze only where the ice is thin (keeps real blacks elsewhere)
F = np.maximum(F, 0.075*glow)

# ---------------- bright masks ----------------
bi = newmask(); bd = ImageDraw.Draw(bi)          # crystals (max brightness)
fi = newmask(); fd = ImageDraw.Draw(fi)          # frost ferns
ri = newmask(); rd = ImageDraw.Draw(ri)          # borders

star_flake(bd, HERO[0], HERO[1], HERO[2], rot=90)
plate(bd, 156.0, 94.0, 33.0, rot=90)
plate(bd, 104.0, 46.0, 19.0, rot=60)
star_flake(bd, 196.0, 52.0, 22.0, rot=90)
dendrite(bd, 112.0, 112.0, 20.0, rot=90)
for cx, cy, rr, ro in ((134.0, 124.0, 9.0, 90), (176.0, 28.0, 8.0, 60),
                       (72.0, 24.0, 8.5, 60), (166.0, 64.0, 8.0, 90),
                       (118.0, 22.0, 8.0, 90), (200.0, 96.0, 8.5, 60),
                       (148.0, 52.0, 8.0, 90)):
    hexagon(bd, cx, cy, rr, ro)
    hexring(bd, cx, cy, rr*0.52, ro, 1.9, 0)

rf = random.Random(9)
for k in range(5):
    fx = (k+0.5)*W/5 + rf.uniform(-7, 7)
    fern(fd, fx, 12.6, 90 + rf.uniform(-22, 22),
         rf.uniform(28, 38), 3.6, 2, rnd=rf)
for k in range(5):
    fx = k*W/5 + rf.uniform(-7, 7)
    fern(fd, fx, 12.6, 90 + rf.uniform(-30, 30),
         rf.uniform(14, 21), 2.8, 1, rnd=rf)

# borders: zigzag band low, hanging icicles up top
for k in range(20):
    x0 = k*W/20
    poly(rd, [(x0, 2.2), (x0+W/40, 7.4), (x0+W/20, 2.2),
              (x0+W/20, 4.6), (x0+W/40, 9.8), (x0, 4.6)], 255)
for yb in (9.9, 133.4):
    poly(rd, [(-W, yb), (2*W, yb), (2*W, yb+1.0), (-W, yb+1.0)], 255)
poly(rd, [(-W, 141.0), (2*W, 141.0), (2*W, H), (-W, H)], 255)
ic = random.Random(4)
for k in range(28):
    x0 = (k+0.5)*W/28
    ln = ic.uniform(6.0, 15.0); bw = ic.uniform(3.4, 5.2)
    poly(rd, [(x0-bw/2, 133.6), (x0+bw/2, 133.6), (x0+bw*0.1, 133.6-ln)], 255)

crys = fold(bi); frost = fold(fi); bord = fold(ri)

# dark separation gaps -> crisp edges (the trick that made the sun read)
F = F*(1.0 - dil(crys, 25))
F = F*(1.0 - 0.92*np.clip(dil(frost, 15) - frost, 0, 1))
F = np.maximum(F, 0.55*frost)
F = np.maximum(F, 1.0*crys)
F = np.where((YY < FLOOR) | (YY > SKYTOP), 0.0, F)
F = np.maximum(F, bord)
F = np.clip(F, 0, 1)

# ---------------- stipple ----------------
PITCH = 1.15
ncols = int(round(W/PITCH)); p = W/ncols
rowsp = p*math.sqrt(3)/2
nrows = int(round(H/rowsp))
JIT = 0.10
D_MIN, D_MAX = 0.26, 0.52
THRESH = 0.05
KNEE = 0.42          # below this, density drops out as well as size

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
        f = float(F[min(Hp-1, max(0, int((H-y2)*PPM))),
                    min(Wp-1, max(0, int(xw*PPM)))])
        if f <= THRESH:
            continue
        t = (52.9829189*((0.06711056*i + 0.00583715*j) % 1.0)) % 1.0
        g = (f-THRESH)/(1-THRESH)
        if t < min(1.0, f/KNEE):
            holes_var.append((xw, H-y2, (D_MIN + (D_MAX-D_MIN)*g)/2))
        if f > 0.78 or f > 0.04 + 0.84*t:
            holes_uni.append((xw, H-y2, 0.33/2))

print(f"canvas {W:.2f} x {H} mm | pitch {p:.3f} | variabel {len(holes_var)} | uniform {len(holes_uni)}")

def write_svg(path, holes, title):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.3f}mm" height="{H:.3f}mm" '
           f'viewBox="0 0 {W:.3f} {H:.3f}">', f'<title>{title}</title>',
           '<g id="holes" fill="#000000" stroke="none">']
    for x, y, r in holes:
        out.append(f'<circle cx="{x:.3f}" cy="{y:.3f}" r="{r:.3f}"/>')
    out += ['</g>', '</svg>']
    open(path, "w").write("\n".join(out))

write_svg("/home/claude/out2/escarcha_variabel.svg", holes_var, "Escarcha - variable dot")
write_svg("/home/claude/out2/escarcha_uniform.svg", holes_uni, "Escarcha - uniform 0.32mm")

# ---------------- previews (cold palette) ----------------
SP = 7
def render(holes):
    im = Image.new("L", (int(W*SP), int(H*SP)), 0)
    d = ImageDraw.Draw(im)
    for x, y, r in holes:
        d.ellipse([(x-r)*SP, (y-r)*SP, (x+r)*SP, (y+r)*SP], fill=255)
    return im

def glowmap(im):
    a = np.asarray(im, np.float32)/255
    b1 = np.asarray(im.filter(ImageFilter.GaussianBlur(1.5)), np.float32)/255
    b2 = np.asarray(im.filter(ImageFilter.GaussianBlur(7.0)), np.float32)/255
    b3 = np.asarray(im.filter(ImageFilter.GaussianBlur(26.0)), np.float32)/255
    L = np.clip(a*1.15 + b1*0.40 + b2*0.16 + b3*0.16, 0, 1.5)
    R = np.clip(L*0.72, 0, 1)**1.10
    G = np.clip(L*0.98, 0, 1)**0.92
    B = np.clip(L*1.30, 0, 1)**0.74
    return (np.clip(np.stack([R, G, B], -1), 0, 1)*255).astype(np.uint8)

flat = glowmap(render(holes_var))
Image.fromarray(flat).save("/home/claude/out2/preview_flat.png")
Image.fromarray(glowmap(render(holes_uni))).save("/home/claude/out2/preview_flat_uniform.png")

def cylinder(f, turns):
    hpix, wpix, _ = f.shape
    R = wpix/(2*math.pi); outw = int(2*R)
    xs = np.clip((np.arange(outw)+0.5 - R)/R, -0.99999, 0.99999)
    th = np.arcsin(xs)
    u = ((th/(2*math.pi))*wpix + turns*wpix) % wpix
    cols = f[:, u.astype(int), :].astype(np.float32)
    cols *= (0.22 + 0.78*np.cos(th)**0.5)[None, :, None]
    return np.clip(cols, 0, 255).astype(np.uint8)

SC = flat.shape[0]/H
CAN_H, BAND_Y = 168.0, 13.0
def can_render(turns):
    band = cylinder(flat, turns); bh, bw, _ = band.shape
    ch = int(CAN_H*SC)
    im = np.zeros((ch, bw, 3), np.float32)
    xs = np.clip((np.arange(bw)+0.5 - bw/2)/(bw/2), -1, 1)
    im[:] = (0.14 + 0.42*np.sqrt(np.clip(1-xs**2, 0, 1)))[None, :, None]*np.array([228, 230, 234])
    top = ch - int((BAND_Y+H)*SC)
    im[top:top+bh] = np.maximum(im[top:top+bh]*0.30, band.astype(np.float32))
    img = Image.fromarray(np.clip(im, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    d.ellipse([0, -int(3.5*SC), bw, int(3.5*SC)], fill=(168, 170, 174))
    d.ellipse([0, ch-int(8*SC), bw, ch-int(1*SC)], fill=(96, 98, 102))
    return img

gap = int(24*SC)
a, b = can_render(52.0/W), can_render(156.0/W)
sheet = Image.new("RGB", (a.width*2 + 3*gap, a.height + 2*gap), (10, 11, 14))
sheet.paste(a, (gap, gap)); sheet.paste(b, (2*gap + a.width, gap))
sheet.filter(ImageFilter.GaussianBlur(0.3)).save("/home/claude/out2/preview_can.png")

from scipy.spatial import cKDTree
def audit(holes, name):
    P_ = np.array([[h[0], h[1]] for h in holes]); R_ = np.array([h[2] for h in holes])
    ext = np.vstack([P_, P_ + [W, 0], P_ - [W, 0]])
    Re = np.concatenate([R_, R_, R_])
    t = cKDTree(ext)
    d, idx = t.query(P_, k=2)
    web = d[:, 1] - R_ - Re[idx[:, 1]]
    print(f"{name}: n={len(holes)}  min web {web.min():.3f} mm  p1 {np.percentile(web,1):.3f}  median {np.median(web):.3f}")
audit(holes_var, "variabel")
audit(holes_uni, "uniform")
print("done")
