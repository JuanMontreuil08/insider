const art = document.getElementById('bay-art');
if (art) {
  const figure = art.closest('.bay-scene');
  // The Blender render stays visible while loading, or if WebGL is unavailable.
  import('./bay-city.js').then(async ({ createBayCity }) => {
    await createBayCity(art, () => { figure.dataset.renderer = 'fallback'; });
    figure.dataset.renderer = 'webgl';
  }).catch(error => {
    figure.dataset.renderer = 'fallback';
    console.warn('City preview unavailable; using the Blender poster.', error);
  });
}
