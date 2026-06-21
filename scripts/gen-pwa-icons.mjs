import sharp from 'sharp';
const src='assets/icon-only.png';           // 1024 brand tile (full-bleed green)
const out=[[192,'icons/icon-192.png'],[512,'icons/icon-512.png'],
  [180,'icons/apple-touch-icon.png'],[32,'icons/favicon-32.png']];
for(const [size,file] of out){
  await sharp(src).resize(size,size).png().toFile(file);
}
console.log('✓ PWA icons generated');
