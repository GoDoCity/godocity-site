"""
Generates topo-banner.png — brand yellow #f9d900 base with dark-grey
contour lines drawn at ~35% opacity, mimicking a USGS topo map texture.
Output: public/images/topo-banner.png  (1200 × 480 px, 24-bit PNG)
"""

import struct, zlib, math, numpy as np

W, H = 1200, 480

# ── Colours ──────────────────────────────────────────────────────────
BG   = np.array([249, 217,   0], dtype=np.float32)   # #f9d900 yellow
LINE = np.array([ 40,  38,   0], dtype=np.float32)   # very dark amber

# Pre-fill canvas with yellow
canvas = np.full((H, W, 3), BG, dtype=np.float32)

def blend(canvas, y, x, alpha):
    """Alpha-composite LINE colour onto canvas at (y,x) with given alpha."""
    if 0 <= x < W and 0 <= y < H:
        a = np.clip(alpha, 0, 1)
        canvas[y, x] = canvas[y, x] * (1 - a) + LINE * a

def wu_hline(canvas, y_float, x0, x1, base_alpha):
    """Draw a single anti-aliased horizontal scanline contribution."""
    y_lo = int(math.floor(y_float))
    y_hi = y_lo + 1
    frac = y_float - y_lo
    for x in range(max(0, int(x0)), min(W, int(x1) + 1)):
        blend(canvas, y_lo, x, base_alpha * (1 - frac))
        blend(canvas, y_hi, x, base_alpha * frac)

def draw_curve(canvas, points, alpha, width=1.0):
    """
    Draw a smooth curve through `points` (list of (x,y) floats) using
    Catmull-Rom interpolation + Wu anti-aliasing.
    `width` > 1 draws extra parallel passes for thicker strokes.
    """
    n = len(points)
    steps_per_seg = 120

    def catmull(p0, p1, p2, p3, t):
        t2, t3 = t*t, t*t*t
        return (
            0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
            0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
        )

    offsets = [0]
    if width > 1:
        hw = (width - 1) * 0.5
        offsets = list(np.linspace(-hw, hw, max(2, int(width * 2))))

    for i in range(1, n - 2):
        p0, p1, p2, p3 = points[max(0,i-1)], points[i], points[i+1], points[min(n-1,i+2)]
        prev = catmull(p0, p1, p2, p3, 0)
        for step in range(1, steps_per_seg + 1):
            t = step / steps_per_seg
            curr = catmull(p0, p1, p2, p3, t)
            dx, dy = curr[0]-prev[0], curr[1]-prev[1]
            seg_len = math.hypot(dx, dy)
            if seg_len < 0.5:
                prev = curr
                continue
            # normal direction for width offset
            nx, ny = -dy/seg_len, dx/seg_len
            for off in offsets:
                x = curr[0] + nx*off
                y = curr[1] + ny*off
                wu_hline(canvas, y, x, x, alpha)
            prev = curr

# ── Contour line definitions ─────────────────────────────────────────
# Each line is a list of (x, y) anchor points.
# We generate rows of sinusoidal curves to mimic organic contour lines.

rng = np.random.default_rng(42)

def make_contour_row(base_y, freq1, freq2, amp1, amp2, phase1, phase2, x_steps=20):
    pts = []
    for i in range(x_steps + 1):
        x = (i / x_steps) * (W + 40) - 20
        y = (base_y
             + amp1 * math.sin(2*math.pi*freq1*x/W + phase1)
             + amp2 * math.sin(2*math.pi*freq2*x/W + phase2))
        pts.append((x, y))
    return pts

# Regular contour lines — thin, dark amber at 35% opacity
regular_alpha = 0.35
row_spacing = 28          # ~17 lines across 480px
for k in range(-1, int(H / row_spacing) + 2):
    base_y  = k * row_spacing + 14
    f1      = 0.9 + rng.uniform(-0.3, 0.3)
    f2      = 2.1 + rng.uniform(-0.5, 0.5)
    a1      = 7  + rng.uniform(-3, 3)
    a2      = 4  + rng.uniform(-2, 2)
    ph1     = rng.uniform(0, 2*math.pi)
    ph2     = rng.uniform(0, 2*math.pi)
    pts = make_contour_row(base_y, f1, f2, a1, a2, ph1, ph2)
    draw_curve(canvas, pts, regular_alpha, width=1.0)

# Index contours — every 5th row, slightly thicker / darker
index_alpha = 0.52
index_spacing = row_spacing * 5
for k in range(-1, int(H / index_spacing) + 2):
    base_y = k * index_spacing + 14
    f1     = 0.85 + rng.uniform(-0.2, 0.2)
    f2     = 1.9  + rng.uniform(-0.3, 0.3)
    a1     = 9   + rng.uniform(-3, 3)
    a2     = 5   + rng.uniform(-2, 2)
    ph1    = rng.uniform(0, 2*math.pi)
    ph2    = rng.uniform(0, 2*math.pi)
    pts = make_contour_row(base_y, f1, f2, a1, a2, ph1, ph2)
    draw_curve(canvas, pts, index_alpha, width=1.8)

# Summit blobs (closed ellipses) — 3 of them
def draw_ellipse(canvas, cx, cy, rx, ry, angle_deg, alpha, width=1.2):
    ang = math.radians(angle_deg)
    pts = []
    steps = 120
    for i in range(steps + 1):
        t = 2 * math.pi * i / steps
        lx = rx * math.cos(t)
        ly = ry * math.sin(t)
        rx2 = lx * math.cos(ang) - ly * math.sin(ang)
        ry2 = lx * math.sin(ang) + ly * math.cos(ang)
        pts.append((cx + rx2, cy + ry2))
    draw_curve(canvas, pts, alpha, width=width)

blobs = [
    (820, 160, 90, 48, -10),
    (260, 350, 70, 36,   8),
    (1050, 80, 55, 28, -15),
    (150, 120, 44, 22,   5),
]
for cx, cy, rx, ry, ang in blobs:
    for scale in [1.0, 0.65, 0.38]:
        draw_ellipse(canvas, cx, cy, rx*scale, ry*scale, ang, 0.40, width=1.1)

# Faint survey grid
for gx in [300, 600, 900]:
    for y in range(H):
        blend(canvas, y, gx, 0.12)
for gy in [160, 320]:
    for x in range(W):
        blend(canvas, gy, x, 0.12)

# ── Write PNG ────────────────────────────────────────────────────────
img = np.clip(canvas, 0, 255).astype(np.uint8)

def make_png(arr):
    h, w = arr.shape[:2]

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig   = b'\x89PNG\r\n\x1a\n'
    ihdr  = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))

    # Build raw scanlines: filter byte 0 + RGB bytes
    raw = bytearray()
    for row in arr:
        raw.append(0)
        raw.extend(row.flatten())
    idat  = chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    iend  = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

png_bytes = make_png(img)
out_path = 'public/images/topo-banner.png'
with open(out_path, 'wb') as f:
    f.write(png_bytes)

kb = len(png_bytes) // 1024
print(f"Written {out_path}  ({W}×{H}px, {kb} KB)")
