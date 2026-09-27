import bpy
s=bpy.context.scene
for o in bpy.data.objects:
 if o.name.startswith('Traffic car') and o.animation_data:
  for layer in o.animation_data.action.layers:
   for strip in layer.strips:
    for bag in strip.channelbags:
     for fc in bag.fcurves:
      if fc.data_path=='scale':
       for key in fc.keyframe_points:
        key.co.y=max(.01,key.co.y)
        key.handle_left.y=max(.01,key.handle_left.y)
        key.handle_right.y=max(.01,key.handle_right.y)
s.frame_end=721
s.frame_set(310)
s.render.resolution_x=1000;s.render.resolution_y=700
s.render.image_settings.media_type='IMAGE';s.render.image_settings.file_format='PNG'
target=artifacts.file(name='insider-connected-final.png',media_type='image/png')
s.render.filepath=str(target.path);bpy.ops.render.render(write_still=True);target.publish()
result={'loopSeconds':30,'minimumScale':.01,'frames':[1,721]}

