import math, sys
import cadquery as cq
V = cq.Vector
out = sys.argv[1]

# ---- Parameter (mm), x=vorn, y=seitlich, z=oben; NAEHERUNG Fitness-Bike Gr. M ----
R_TIRE = 340.0      # 700x32c Aussenradius
TIRE_W = 32.0
R_RIM = 311.0 + 12  # Felgenaussen (ISO 622 + Profil)
BB_DROP, CS = 70.0, 435.0
WB = 1040.0
HA, SA = 71.5, 73.5
ST_LEN, HT_LEN = 540.0, 130.0
FORK_OFFSET, FORK_A2C = 45.0, 375.0

def tube(p1, p2, d, di=None):
    p1, p2 = V(*p1), V(*p2)
    v = p2 - p1
    s = cq.Solid.makeCylinder(d/2, v.Length, p1, v.normalized())
    if di:
        s = s.cut(cq.Solid.makeCylinder(di/2, v.Length, p1, v.normalized()))
    return s

def comp(*solids): return cq.Compound.makeCompound(list(solids))

ra = (0, 0, R_TIRE)
fa = (WB, 0, R_TIRE)
bb = (math.sqrt(CS**2 - BB_DROP**2), 0, R_TIRE - BB_DROP)
a = math.radians(HA); u = (-math.cos(a), math.sin(a)); n = (math.sin(a), math.cos(a))
ax = (fa[0] - FORK_OFFSET*n[0], fa[2] - FORK_OFFSET*n[1])
cr = (ax[0] + FORK_A2C*u[0], ax[1] + FORK_A2C*u[1])           # Gabelkrone
htb = (cr[0] + 8*u[0], cr[1] + 8*u[1])
htt = (htb[0] + HT_LEN*u[0], htb[1] + HT_LEN*u[1])
s = math.radians(SA)
stt = (bb[0] - ST_LEN*math.cos(s), bb[2] + ST_LEN*math.sin(s))  # Sitzrohr oben
X = lambda p, y=0: (p[0], y, p[1])

parts = {}
# Rahmen
parts['rahmen'] = comp(
    tube(X(htb), X(htt), 46, 40),
    tube(X(stt), X((htt[0]-0.0, htt[1]-18)), 34, 28),                 # Oberrohr
    tube((bb[0], 0, bb[2]), X((htb[0], htb[1]+22)), 46, 40),           # Unterrohr
    tube((bb[0], 0, bb[2]), X(stt), 34, 29),                           # Sitzrohr
    tube((bb[0], -36, bb[2]), (bb[0], 36, bb[2]), 40, 34),             # Tretlagergehaeuse
    *[tube((bb[0], sg*30, bb[2]), (ra[0], sg*65, ra[2]), 20, 15) for sg in (-1, 1)],   # Kettenstreben
    *[tube(X(stt, sg*0), (ra[0], sg*65, ra[2]), 16, 12) if False else
      tube((stt[0], 0, stt[1]-40), (ra[0], sg*65, ra[2]), 16, 12) for sg in (-1, 1)],  # Sitzstreben
)
# Gabel
parts['gabel'] = comp(
    tube(X(cr, -50), X(cr, 50), 36),
    *[tube(X(cr, sg*50), (fa[0], sg*50, fa[2]), 22, 17) for sg in (-1, 1)],
    tube(X(cr), X((cr[0]-120*u[0], cr[1]-120*u[1])) if False else X((cr[0]+160*u[0], cr[1]+160*u[1])), 28),  # Schaft
)
# Raeder
def wheel(c):
    tire = cq.Solid.makeTorus(R_TIRE - TIRE_W/2, TIRE_W/2, V(*c), V(0, 1, 0))
    rim = cq.Workplane("XZ", origin=(c[0], 11, c[2])).circle(R_RIM).circle(R_RIM-18).extrude(22)
    hub = cq.Workplane("XZ", origin=(c[0], 30, c[2])).circle(20).extrude(60)
    ws = [tire, rim.val(), hub.val()]
    for i in range(32):
        t = 2*math.pi*i/32; side = 1 if i % 2 else -1
        p = (c[0] + (R_RIM-18)*math.cos(t), 0, c[2] + (R_RIM-18)*math.sin(t))
        ws.append(tube((c[0], side*28, c[2]), (p[0], side*3, p[2]), 2))
    return comp(*ws)
parts['vorderrad'] = wheel(fa); parts['hinterrad'] = wheel(ra)
# Cockpit
sh_top = (cr[0]+170*u[0], cr[1]+170*u[1])
stem_end = (sh_top[0] + 90, sh_top[1] + 15)
parts['vorbau_lenker'] = comp(
    tube(X(sh_top), X((sh_top[0], sh_top[1]+35)), 36),
    tube(X((sh_top[0], sh_top[1]+20)), X(stem_end), 34, 28),
    tube(X(stem_end, -300), X(stem_end, 300), 22.2, 18),
    *[tube(X(stem_end, sg*300), X((stem_end[0]-25, stem_end[1]-20), sg*340), 22.2) for sg in (-1, 1)],
    *[tube(X((stem_end[0]-25, stem_end[1]-20), sg*140), X((stem_end[0]-25, stem_end[1]-20), sg*290), 32) for sg in (-1, 1)],  # Griffe
)
# Sattel + Stuetze
sp_dir = (-math.cos(s), math.sin(s))
sp_top = (stt[0] + 150*sp_dir[0], stt[1] + 150*sp_dir[1])
saddle = (cq.Workplane("XY").box(250, 140, 45).edges("|Z").fillet(40).translate((sp_top[0]-10, 0, sp_top[1]+25)).val())
parts['sattel'] = comp(tube(X((stt[0]-60*sp_dir[0], stt[1]-60*sp_dir[1])), X(sp_top), 27.2), saddle)
# Antrieb
ang = math.radians(-20)
arm = lambda sg: (bb[0] + 170*math.cos(ang if sg > 0 else ang+math.pi), sg*68, bb[2] + 170*math.sin(ang if sg > 0 else ang+math.pi))
cw = cq.Workplane("XZ", origin=(bb[0], 55, bb[2])).circle(95).circle(80).extrude(3).val()
cass = cq.Workplane("XZ", origin=(ra[0], 20, ra[2])).circle(55).circle(22).extrude(40).val()
parts['antrieb'] = comp(
    tube((bb[0], -68, bb[2]), (bb[0], 68, bb[2]), 24),
    tube((bb[0], 68, bb[2]), arm(1), 24), tube((bb[0], -68, bb[2]), arm(-1), 24),
    cq.Workplane("XY").box(100, 85, 18).translate(arm(1)[0:2] + (arm(1)[2],)).translate((0, 60-0, 0)).val(),
    cq.Workplane("XY").box(100, 85, 18).translate(arm(-1)).translate((0, -60, 0)).val(),
    cw, cass,
)
# Zusammenbau + STEP
asm = cq.Assembly(name="Felt_FX3_2017_approx")
for k, v in parts.items(): asm.add(v, name=k)
asm.save(out, "STEP")
bbx = comp(*parts.values()).BoundingBox()
print("bbox", round(bbx.xlen), round(bbx.ylen), round(bbx.zlen))
