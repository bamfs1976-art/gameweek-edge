import sharp from 'sharp';
const src='assets/icon-only.png';           // 1024 brand tile with GWE lettering
const mark='assets/icon-mark.png';          // chart-only mark for tiny sizes
const out=[[192,'icons/icon-192.png',src],[512,'icons/icon-512.png',src],
  [180,'icons/apple-touch-icon.png',src],[32,'icons/favicon-32.png',mark]];
for(const [size,file,from] of out){
  await sharp(from).resize(size,size).png().toFile(file);
}
console.log('✓ PWA icons generated (favicon keeps the plain mark)');
