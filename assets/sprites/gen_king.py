"""Generate a 32x32 pixel-art king sprite (side view, facing right) for a sidescroller."""
from PIL import Image

W, H = 32, 32
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()

def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        px[x, y] = c

def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(x, y, c)

# ---- palette ----
SKIN      = (255, 213, 170, 255)
SKIN_SH   = (222, 175, 132, 255)
CROWN     = (255, 213, 74, 255)
CROWN_SH  = (206, 160, 42, 255)
GEM       = (214, 48, 64, 255)
ROBE      = (128, 64, 158, 255)
ROBE_SH   = (94, 42, 122, 255)
ROBE_HI   = (162, 96, 190, 255)
CAPE      = (98, 32, 96, 255)
CAPE_SH   = (72, 20, 70, 255)
FUR       = (247, 247, 245, 255)
FUR_SPOT  = (40, 38, 44, 255)
GOLD      = (255, 213, 74, 255)
GOLD_SH   = (206, 160, 42, 255)
BOOT      = (94, 58, 40, 255)
BOOT_SH   = (66, 40, 28, 255)
BEARD     = (232, 232, 232, 255)
BEARD_SH  = (200, 200, 202, 255)
EYE       = (34, 30, 36, 255)

# ---- cape (drawn first, sits behind the body, trails to the left) ----
rect(6, 16, 10, 27, CAPE)
rect(6, 16, 7, 27, CAPE_SH)
put(6, 15, CAPE); put(7, 15, CAPE)
put(6, 28, CAPE_SH); put(7, 28, CAPE_SH); put(8, 28, CAPE_SH)

# ---- legs / robe hem (long robe, boots peeking out) ----
rect(11, 27, 14, 29, BOOT)
rect(18, 27, 21, 29, BOOT)
rect(11, 29, 14, 30, BOOT_SH)
rect(18, 29, 21, 30, BOOT_SH)

# ---- robe body (trapezoid, wider at hem) ----
for y in range(15, 27):
    t = (y - 15) / 11.0
    left = round(12 - t * 3)
    right = round(20 + t * 4)
    rect(left, y, right, y, ROBE)
# shade the trailing (left/back) side and highlight the leading (right/front) edge
for y in range(15, 27):
    t = (y - 15) / 11.0
    left = round(12 - t * 3)
    right = round(20 + t * 4)
    rect(left, y, left + 1, y, ROBE_SH)
    put(right, y, ROBE_HI)

# belt
rect(10, 21, 22, 22, GOLD)
rect(10, 22, 22, 22, GOLD_SH)
put(16, 21, GEM)

# ---- arms / hands ----
# back hand resting at hip (mostly hidden, just a hint)
rect(9, 19, 10, 21, ROBE_SH)
# front arm + hand down at the side
rect(21, 17, 23, 21, ROBE)
rect(22, 17, 23, 18, ROBE_SH)
rect(21, 21, 23, 23, SKIN)
put(21, 23, SKIN_SH); put(23, 21, SKIN_SH)

# ---- ermine collar (white fur trim across the shoulders) ----
rect(10, 14, 22, 15, FUR)
put(11, 15, FUR_SPOT); put(15, 14, FUR_SPOT); put(19, 15, FUR_SPOT); put(21, 14, FUR_SPOT)

# ---- neck ----
rect(14, 12, 17, 14, SKIN)
put(14, 13, SKIN_SH); put(14, 14, SKIN_SH)

# ---- head ----
rect(13, 6, 20, 12, SKIN)
put(13, 6, (0, 0, 0, 0)); put(20, 6, (0, 0, 0, 0))
put(13, 12, (0, 0, 0, 0)); put(20, 12, (0, 0, 0, 0))
rect(13, 7, 13, 11, SKIN_SH)  # back-of-head shade
# nose (facing right)
put(21, 9, SKIN)
put(22, 9, SKIN)
put(21, 10, SKIN_SH)
# eye
put(19, 9, EYE)
# mouth
put(18, 11, SKIN_SH); put(19, 11, SKIN_SH)
# beard
rect(15, 12, 20, 14, BEARD)
rect(15, 13, 20, 14, BEARD_SH)
put(21, 12, BEARD); put(21, 13, BEARD_SH)

# ---- crown ----
rect(13, 4, 20, 6, CROWN)
rect(13, 6, 20, 6, CROWN_SH)
# points
for x, y0 in [(13, 2), (16, 1), (20, 2)]:
    rect(x, y0, x + 1, 3, CROWN)
put(16, 1, CROWN); put(17, 1, CROWN)
# gem on the band
put(16, 5, GEM); put(17, 5, GEM)

# ---- outline pass: dilate the silhouette by 1px and ink it dark ----
OUTLINE = (28, 20, 24, 255)
alpha = [[px[x, y][3] > 0 for x in range(W)] for y in range(H)]
outline_px = set()
for y in range(H):
    for x in range(W):
        if alpha[y][x]:
            continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and alpha[ny][nx]:
                outline_px.add((x, y))
                break
for x, y in outline_px:
    px[x, y] = OUTLINE

img.save("king_32.png")

# upscaled nearest-neighbor preview for easy viewing
preview = img.resize((W * 12, H * 12), Image.NEAREST)
preview.save("king_32_preview.png")

print("done")
