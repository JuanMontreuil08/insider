import bpy, math
from mathutils import Vector
s=bpy.context.scene
# Move the neighborhood as one unit, preserving the bridge and all user materials.
city_prefixes=('Waterfront ground','Embarcadero','Lane marking','Stone curb','Victorian','Clapboard','Cornice','Gabled roof','Gable trim','Window','Warm window','Projecting bay','Bay sill','Bay cornice','Front door','Porch steps','Chimney','Tree trunk','Cypress canopy','Downtown block','Roof cornice','Transamerica','Pyramid spire','Salesforce','Tower window','Street pool')
for o in bpy.data.objects:
 if o.name.startswith(city_prefixes):o.location.x+=12
road=bpy.data.materials['Asphalt'];trim=bpy.data.materials['Ivory trim'];stone=bpy.data.materials['Limestone']
def center(t):
 a=Vector((1.5,1,3.4));b=Vector((5.5,1,3.4));c=Vector((5,-4,.29));d=Vector((9,-4,.29))
 return (1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d
def normal(t):
 v=center(min(1,t+.001))-center(max(0,t-.001))
 return Vector((-v.y,v.x,0)).normalized()
def ribbon(name,offset,width,height,mat):
 verts=[]
 for i in range(81):
  t=i/80;p=center(t);n=normal(t)
  for side in [-1,1]:verts.append(tuple(p+n*(offset+side*width/2)+Vector((0,0,height))))
 faces=[(2*i,2*i+1,2*i+3,2*i+2) for i in range(80)]
 m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.materials.append(mat)
 o=bpy.data.objects.new(name,m);s.collection.objects.link(o)
 sol=o.modifiers.new('Road thickness','SOLIDIFY');sol.thickness=.16
 return o
ribbon('Coastal connector asphalt',0,1.7,0,road)
for side in [-1,1]:
 ribbon('Connector stone parapet',side*.94,.18,.19,stone)
 ribbon('Connector edge stripe',side*.76,.035,.012,trim)
# Dashed center line follows exactly the same surface.
for i in range(0,80,5):
 pts=[]
 for j in range(i,min(i+3,81)):
  p=center(j/80);p.z+=.015;pts.append(p)
 c=bpy.data.curves.new('Connector lane dash','CURVE');c.dimensions='3D';c.bevel_depth=.022;c.bevel_resolution=0
 sp=c.splines.new('POLY');sp.points.add(len(pts)-1)
 for p,v in zip(sp.points,pts):p.co=(*v,1)
 o=bpy.data.objects.new('Connector lane dash',c);s.collection.objects.link(o);c.materials.append(trim)
# Grounded supporting piers, no floating roadway.
for t in [.15,.4,.65,.85]:
 p=center(t);h=max(.15,p.z-.23)
 bpy.ops.mesh.primitive_cube_add(size=1,location=(p.x,p.y,h/2))
 o=bpy.context.object;o.name='Connector support pier';o.dimensions=(.55,1.3,h);o.data.materials.append(stone)
# Arc-length parameterized traffic: bridge -> ramp -> avenue.
points=[Vector((-25.3+i*26.8/100,1,3.4)) for i in range(101)]
points += [center(i/100) for i in range(1,101)]
points += [Vector((9+i*23.5/100,-4,.29)) for i in range(1,101)]
lengths=[0]
for a,b in zip(points,points[1:]):lengths.append(lengths[-1]+(b-a).length)
def sample(distance):
 import bisect
 k=min(len(points)-2,max(0,bisect.bisect_right(lengths,distance)-1))
 t=(distance-lengths[k])/(lengths[k+1]-lengths[k])
 p=points[k].lerp(points[k+1],t);d=(points[k+1]-points[k]).normalized()
 return p,d
cars=sorted([o for o in bpy.data.objects if o.name.startswith('Traffic car')],key=lambda o:o.name)
s.frame_end=720
for i,o in enumerate(cars):
 o.animation_data_clear()
 for f in range(1,722):
  t=((f-1)/720+i/len(cars))%1
  p,d=sample(t*lengths[-1]);n=Vector((-d.y,d.x,0)).normalized()
  o.location=p+n*.4+Vector((0,0,.02))
  o.rotation_euler=(0,-math.atan2(d.z,math.hypot(d.x,d.y)),math.atan2(d.y,d.x))
  o.scale=(min(1,t*90,(1-t)*90),)*3
  for prop in ['location','rotation_euler','scale']:o.keyframe_insert(data_path=prop,frame=f)
 # Deliberate constant-speed interpolation.
 if o.animation_data:
  for layer in o.animation_data.action.layers:
   for strip in layer.strips:
    for bag in strip.channelbags:
     for fc in bag.fcurves:
      for key in fc.keyframe_points:key.interpolation='LINEAR'
s.camera.location=(-29,-60,32)
s.camera.rotation_euler=(Vector((4,0,4))-s.camera.location).to_track_quat('-Z','Y').to_euler()
s.camera.data.ortho_scale=65
s.frame_set(310)
s.render.resolution_x=1000;s.render.resolution_y=700
s.render.image_settings.media_type='IMAGE';s.render.image_settings.file_format='PNG'
target=artifacts.file(name='insider-connected.png',media_type='image/png');s.render.filepath=str(target.path)
bpy.ops.render.render(write_still=True);target.publish()
result={'routeLength':lengths[-1],'start':list(center(0)),'end':list(center(1)),'cars':len(cars)}

