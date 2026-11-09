"""Generate the BREACH pixel-art favicons into public/.

A breached concrete lab wall (Tier 1 block, blue tier paint) with a ball
bursting through. Usage: python3 scripts/generate-favicon.py public
Requires Pillow.
"""
import math, random, sys
from PIL import Image

def h(x,y,s):
    n = (x*374761393 + y*668265263 + s*1442695041) & 0xffffffff
    n = ((n ^ (n>>13)) * 1274126177) & 0xffffffff
    return (n & 0xffff)/65535

BASE=(44,40,35); PAINT=(62,92,138); MORTAR=(22,20,18)
def mul(c,k): return tuple(max(0,min(255,int(v*k))) for v in c)

def draw(N, rounded=True):
    s = N/32  # scale of design units
    img = Image.new("RGBA",(N,N),(0,0,0,0))
    px = img.load()
    cx, cy = N*0.5, N*0.47
    R = N*0.34
    # rounded-square tile
    rad = max(1, round(N*0.12)) if rounded else 0
    for y in range(N):
        for x in range(N):
            # corner rounding
            dx = max(rad-x-0.5, x+0.5-(N-rad), 0); dy = max(rad-y-0.5, y+0.5-(N-rad), 0)
            if rad and dx*dx+dy*dy > rad*rad: continue
            # concrete blocks: course height, block len in design units
            ch = max(2, round(8*s)) if N>=32 else 4
            bl = ch*2
            course = y//ch; off = (course&1)*(bl//2)
            if N>=24 and (y%ch==0 or (x+off)%bl==0): c = MORTAR
            elif N<24 and (y%ch==0): c = mul(BASE,0.62)
            else:
                k = 0.85+h((x+off)//bl,course,7)*0.3
                if N>=32: k *= 0.92+h(x,y,3)*0.16
                if N>=32 and y%ch==1: k*=1.12
                c = mul(BASE,k*1.25)
            # paint band near bottom
            band_top = N - max(2, round(5*s)); band_bot = N - max(1, round(2*s))
            if band_top <= y < band_bot:
                k = 0.9+h(x,y,9)*0.15 if N>=32 else 1
                c = mul(PAINT,k)
                if N>=32 and h(x,y,11)<0.12: c = mul(BASE,1.1)  # chipped
            # dark vignette edge
            edge = min(x,y,N-1-x,N-1-y)
            if edge==0 and rounded: c = mul(c,0.55)
            px[x,y] = c+(255,)
    # breach: jagged hole
    for y in range(N):
        for x in range(N):
            if px[x,y][3]==0: continue
            ddx=x+0.5-cx; ddy=y+0.5-cy
            a = math.atan2(ddy,ddx); d = math.hypot(ddx,ddy)
            j = R*(0.78 + 0.22*math.sin(a*7+1.3) * (0.6+0.4*math.sin(a*3)))
            if d < j:
                # void with faint warm depth
                t = d/j
                c = mul((26,16,10), 1-t*0.7) if N>=32 else (10,8,7)
                px[x,y]=c+(255,)
            elif d < j + max(1,1.6*s):
                # shattered rim: lit top-left, shadow bottom-right
                lit = -(ddx+ddy)/(d+1e-6)
                c = mul(BASE, 1.5 if lit>0.2 else 0.6)
                px[x,y]=c+(255,)
    # cracks radiating
    if N>=32:
        random.seed(4)
        for ang in (0.5, 2.3, 3.6, 5.2, 4.4):
            x, y = cx+math.cos(ang)*R*0.95, cy+math.sin(ang)*R*0.95
            for i in range(int(7*s)):
                ang += (random.random()-0.5)*0.9
                x += math.cos(ang); y += math.sin(ang)
                ix, iy = int(x), int(y)
                if 1<=ix<N-1 and 1<=iy<N-1: px[ix,iy]=MORTAR+(255,)
    # the ball, bursting out toward upper right
    bx, by, br = cx+N*0.10, cy-N*0.05, N*0.17
    for y in range(N):
        for x in range(N):
            ddx=x+0.5-bx; ddy=y+0.5-by; d=math.hypot(ddx,ddy)
            if d<br:
                # spherical shade, light from upper-left (muzzle-flash warm)
                nz = math.sqrt(max(0,1-(d/br)**2))
                l = max(0, (-ddx*0.55 - ddy*0.65)/br + nz*0.7)
                cols = [(70,40,22),(150,82,30),(214,140,52),(246,214,140),(255,248,226)]
                i = min(len(cols)-1, int(l*len(cols)*0.8))
                px[x,y]=cols[i]+(255,)
            elif d<br+max(1,0.9*s) and px[x,y][3]:
                px[x,y]=(12,9,7,255)
    # debris chunks flying
    chunks = [(0.80,0.20,1.2),(0.88,0.36,0.9),(0.70,0.10,0.8),(0.20,0.22,0.8),(0.86,0.12,0.7)]
    if N<24: chunks = chunks[:2]
    for fx,fy,sz in chunks:
        x0,y0 = int(fx*N), int(fy*N); w = max(1, round(sz*1.5*s))
        for yy in range(y0,min(N,y0+w)):
            for xx in range(x0,min(N,x0+w)):
                if px[xx,yy][3]: px[xx,yy]=(mul(BASE,1.9) if yy==y0 else mul(BASE,1.1))+(255,)
    return img

out = sys.argv[1] if len(sys.argv) > 1 else "public"
import os; os.makedirs(out, exist_ok=True)
for n in (16,32,48):
    draw(n).save(f"{out}/favicon-{n}.png")
# Larger icons: low-res pixel art scaled up with nearest-neighbor so pixels stay crisp.
draw(36, rounded=False).resize((180,180), Image.NEAREST).save(f"{out}/apple-touch-icon.png")
draw(32).resize((192,192), Image.NEAREST).save(f"{out}/icon-192.png")
draw(32).resize((512,512), Image.NEAREST).save(f"{out}/icon-512.png")
imgs=[draw(n) for n in (16,32,48)]
imgs[2].save(f"{out}/favicon.ico", sizes=[(16,16),(32,32),(48,48)], append_images=imgs[:2])
