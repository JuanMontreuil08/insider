import bpy
s=bpy.context.scene
for i,o in enumerate(sorted([o for o in bpy.data.objects if o.name.startswith('Traffic car')],key=lambda o:o.name)):
 o.animation_data_clear()
 for f in range(1,242):
  t=((f-1)/240+i/6)%1
  o.location.x=-24+24*t
  o.scale=(min(1,t*30,(1-t)*30),)*3
  o.keyframe_insert(data_path='location',frame=f)
  o.keyframe_insert(data_path='scale',frame=f)
s.frame_set(1)
s.render.resolution_x=800
s.render.resolution_y=560
s.camera.data.ortho_scale=50
s.render.image_settings.media_type='IMAGE'
s.render.image_settings.file_format='PNG'
target=artifacts.file(name='insider-refined.png',media_type='image/png')
s.render.filepath=str(target.path)
bpy.ops.render.render(write_still=True)
target.publish()
result={'traffic':'bounded to bridge with fade at endpoints','preview':'insider-refined.png'}

