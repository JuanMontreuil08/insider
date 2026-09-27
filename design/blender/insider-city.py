import bpy, math
from mathutils import Vector
s=bpy.context.scene
s.render.engine='BLENDER_EEVEE'
s.render.resolution_x=1000
s.render.resolution_y=850
s.render.resolution_percentage=100
s.render.fps=24
s.frame_start=1
s.frame_end=240
def material(name,c,emit=0,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.42;p.inputs['Metallic'].default_value=metal
 if emit:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
 return m
stone=material('Limestone',(0.42,.43,.33))
trim=material('Ivory trim',(.73,.68,.52))
roof=material('Patinated copper',(.065,.16,.14),metal=.3)
red=material('International orange',(.52,.12,.045),metal=.25)
water=material('Bay water',(.018,.075,.075),metal=.5)
road=material('Asphalt',(.08,.10,.09))
glass=material('Warm occupied windows',(1,.57,.2),2)
dark=material('Dark glass',(.028,.085,.075),metal=.3)
green=material('Cypress',(.055,.14,.07))
facades=[material('Facade '+str(i),c) for i,c in enumerate([(.32,.44,.34),(.57,.37,.20),(.43,.25,.20),(.47,.49,.38)])]
bpy.ops.mesh.primitive_cube_add()
cube=bpy.context.object.data.copy();bpy.data.objects.remove(bpy.context.object,do_unlink=True)
def box(name,loc,size,mat,bevel=0):
 mesh=cube.copy() if bevel else cube
 # Shared meshes by material avoid material-slot collisions.
 key=mat.name
 if key not in boxes:
  boxes[key]=cube.copy();boxes[key].materials.clear();boxes[key].materials.append(mat)
 mesh=boxes[key]
 o=bpy.data.objects.new(name,mesh);s.collection.objects.link(o);o.location=loc;o.scale=tuple(v/2 for v in size)
 return o
boxes={}
def line(name,a,b,r,mat):
 curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=r;curve.bevel_resolution=2
 sp=curve.splines.new('POLY');sp.points.add(len(a)-1) if False else None
 sp.points.add(1);sp.points[0].co=(*a,1);sp.points[1].co=(*b,1)
 o=bpy.data.objects.new(name,curve);s.collection.objects.link(o);curve.materials.append(mat);return o
def cable(name,pts,r,mat):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=2
 p=c.splines.new('POLY');p.points.add(len(pts)-1)
 for q,v in zip(p.points,pts):q.co=(*v,1)
 o=bpy.data.objects.new(name,c);s.collection.objects.link(o);c.materials.append(mat)
def pane(x,y,z,w=.3,h=.6):
 box('Window frame',(x,y,z),(w+.10,.10,h+.12),trim)
 box('Warm window',(x,y-.07,z),(w,.025,h),glass)
 box('Window mullion',(x,y-.09,z),(.028,.025,h),trim)
def tree(x,y):
 line('Tree trunk',(x,y,.2),(x,y,1.5),.06,stone)
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=(x,y,1.8))
 o=bpy.context.object;o.name='Cypress canopy';o.scale=(.38,.38,.9);o.data.materials.append(green)
box('Bay',(0,0,-.4),(160,160,.5),water)
box('Waterfront ground',(9,1,0),(23,13,.4),stone)
box('Embarcadero',(9,-4,.23),(24,2,.12),road)
for x in range(-2,21,2):box('Lane marking',(x,-4,.30),(.8,.045,.015),trim)
for y in [-2.9,-5.1]:box('Stone curb',(9,y,.35),(24,.2,.25),trim)
# Bridge angled into the frame, foreground to skyline.
box('Bridge roadway',(-12,1,3.3),(27,1.7,.2),road)
box('Bridge girder',(-12,1,3.05),(27,1.95,.3),red)
for x in [-21,-8]:
 box('Tower foundation',(x,1,.2),(1.5,3.3,.8),stone)
 for y in [-.15,2.15]:
  box('Tower leg',(x,y,6.2),(.55,.55,12),red)
  box('Tower cap',(x,y,12.25),(.75,.75,.25),red)
 for z in [4,6.6,9.2,11.8]:
  box('Tower crossbeam',(x,1,z),(.5,2.8,.30),red)
  if z<10:
   line('Tower bracing',(x,-.1,z),(x,2.1,z+2.2),.065,red)
   line('Tower bracing',(x,2.1,z),(x,-.1,z+2.2),.065,red)
for y in [-.05,2.05]:
 for a,b,za,zb,sag in [(-25.5,-21,3.8,12,0),(-21,-8,12,12,6),(-8,1.5,12,3.8,0)]:
  pts=[]
  for i in range(51):
   t=i/50;pts.append((a+(b-a)*t,y,za+(zb-za)*t-4*sag*t*(1-t)))
  cable('Suspension cable',pts,.06,red)
  for i in range(1,int((b-a)/.55)):
   t=i*.55/(b-a);x=a+i*.55;z=za+(zb-za)*t-4*sag*t*(1-t)
   line('Suspender',(x,y,3.6),(x,y,z),.018,red)
 box('Bridge handrail',(-12,y,3.8),(27,.06,.07),red)
 for i in range(49):
  x=-25+i*.55;line('Railing post',(x,y,3.35),(x,y,3.8),.023,red)
# Layered, finely articulated Victorian homes.
for i in range(7):
 x=1+i*2.65;y=-.7;h=3.6+(i%3)*.3;f=facades[i%4]
 box('Victorian '+str(i),(x,y,h/2+.35),(2.2,2.5,h),f)
 for j in range(int(h/.18)):
  box('Clapboard',(x,y-1.26,.55+j*.18),(2.18,.035,.022),trim)
 for z in [1.4,2.7,h+.35]:box('Cornice',(x,y,z),(2.4,2.7,.12),trim)
 verts=[(-1.25,-1.45,0),(1.25,-1.45,0),(0,-1.45,1.1),(-1.25,1.45,0),(1.25,1.45,0),(0,1.45,1.1)]
 mesh=bpy.data.meshes.new('Gabled roof');mesh.from_pydata(verts,[],[(0,1,2),(3,5,4),(0,3,4,1),(0,2,5,3),(1,4,5,2)]);mesh.materials.append(roof)
 o=bpy.data.objects.new('Gabled roof',mesh);s.collection.objects.link(o);o.location=(x,y,h+.42)
 line('Gable trim',(x-1.2,y-1.48,h+.44),(x,y-1.48,h+1.5),.045,trim)
 line('Gable trim',(x,y-1.48,h+1.5),(x+1.2,y-1.48,h+.44),.045,trim)
 pane(x,y-1.49,h+.8,.28,.32)
 for z in [1.95,3.1]:
  box('Projecting bay',(x-.38,y-1.45,z),(.95,.7,1.0),f)
  pane(x-.38,y-1.82,z,.42,.65);pane(x+.65,y-1.28,z,.3,.62)
  box('Bay sill',(x-.38,y-1.52,z-.53),(1.08,.85,.1),trim)
  box('Bay cornice',(x-.38,y-1.52,z+.53),(1.08,.85,.1),trim)
 box('Front door',(x+.62,y-1.29,.88),(.4,.1,1.05),roof)
 for j in range(4):box('Porch steps',(x+.62,y-1.65-j*.16,.4-j*.08),(.68,.34,.14),stone)
 box('Chimney',(x+.6,y+.5,h+.9),(.3,.4,1),f)
 tree(x-1.05,-2.6)
# Skyline behind the neighborhood.
for x,y,w,h in [(1,4,2.4,6),(5,5,2.8,8.4),(17,5,2.8,7),(20,3,2.6,5.7)]:
 box('Downtown block',(x,y,h/2),(w,2.6,h),facades[int(x)%4])
 box('Roof cornice',(x,y,h+.1),(w+.25,2.9,.2),trim)
 for z in range(1,int(h)):
  for j in range(3):pane(x-w/2+.45+j*.65,y-1.33,z,.3,.5)
# Transamerica pyramid.
bpy.ops.mesh.primitive_cone_add(vertices=4,radius1=1.7,radius2=.04,depth=12,location=(10,5,6))
o=bpy.context.object;o.name='Transamerica Pyramid';o.rotation_euler.z=math.pi/4;o.data.materials.append(trim)
line('Pyramid spire',(10,5,12),(10,5,13.4),.025,trim)
# Salesforce: gently tapered elliptical tower and rounded crown.
verts=[];faces=[];N=40;R=32
for k in range(R+1):
 z=k*15/R;r=1.55-z*.015 if z<11.8 else 1.373*math.sqrt(max(.002,1-((z-11.8)/3.2)**2))
 for j in range(N):
  a=j*2*math.pi/N;verts.append((14+r*math.cos(a),5+.78*r*math.sin(a),z))
for k in range(R):
 for j in range(N):
  a=k*N+j;b=k*N+(j+1)%N;faces.append((a,b,b+N,a+N))
mesh=bpy.data.meshes.new('Salesforce envelope');mesh.from_pydata(verts,[],faces);mesh.materials.append(dark)
o=bpy.data.objects.new('Salesforce Tower',mesh);s.collection.objects.link(o)
for p in mesh.polygons:p.use_smooth=True
for k in range(29):
 z=.4+k*.49;r=1.55-z*.015 if z<11.8 else 1.373*math.sqrt(max(.002,1-((z-11.8)/3.2)**2))
 for j in range(24):
  a=j*2*math.pi/24
  o=box('Tower window',(14+(r+.02)*math.cos(a),5+.78*(r+.02)*math.sin(a),z),(.08,.06,.16),glass if (j+k)%4 else dark);o.rotation_euler.z=a
# Cars: ten-second seamless traffic loop on the bridge.
for i in range(6):
 root=bpy.data.objects.new('Traffic car '+str(i),None);s.collection.objects.link(root)
 for name,loc,size,m in [('Body',(0,0,.15),(.75,.34,.2),facades[i%4]),('Cabin',(-.03,0,.3),(.38,.3,.16),dark),('Headlights',(.38,0,.18),(.03,.27,.05),glass)]:
  o=box(name,loc,size,m);o.parent=root
 # Wrap happens beyond the camera-visible approach.
 root.location=(-30+i*6,.5 if i%2 else 1.5,3.42);root.keyframe_insert(data_path='location',frame=1)
 root.location.x+=36;root.keyframe_insert(data_path='location',frame=241)
# Lighting and delivery camera are part of editable scene.
s.world=bpy.data.worlds.new('Blue hour atmosphere');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.025,.055,.075,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.4
def light(name,kind,loc,power,color,target=(0,0,0)):
 d=bpy.data.lights.new(name,kind);d.energy=power;d.color=color;o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o
key=light('Warm sunset key','SUN',(-18,-25,30),2.2,(1,.73,.46));key.data.angle=.12
light('Cool sky fill','SUN',(20,15,30),.8,(.4,.65,1))
for x in [0,8,16]:
 l=light('Street pool','POINT',(x,-3,2.8),65,(1,.53,.2));l.data.shadow_soft_size=1.1
cam=bpy.data.cameras.new('Hero delivery camera');o=bpy.data.objects.new('Hero delivery camera',cam);s.collection.objects.link(o);o.location=(-30,-55,28);o.rotation_euler=(Vector((-2,1,4.5))-o.location).to_track_quat('-Z','Y').to_euler();cam.type='ORTHO';cam.ortho_scale=52;s.camera=o
s.frame_set(1)
s.render.image_settings.media_type='IMAGE';s.render.image_settings.file_format='PNG'
target=artifacts.file(name='insider-blue-hour.png',media_type='image/png');s.render.filepath=str(target.path);bpy.ops.render.render(write_still=True);target.publish()
result={'objects':len(bpy.data.objects),'camera':cam.name,'frames':[1,240],'preview':'insider-blue-hour.png'}

