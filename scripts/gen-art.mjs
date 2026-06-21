import sharp from 'sharp';
const GREEN='#15824a', GREEN_BRIGHT='#1f9d5c';
const LIGHT_BG='#f4f6f8', DARK_BG='#0f161d';

const iconCentered = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${GREEN_BRIGHT}"/><stop offset="1" stop-color="${GREEN}"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <g transform="translate(512,512) scale(17) translate(-19,-19)">
    <path d="M9 25.5 L16 17 L22 22 L30 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="30" cy="11" r="3.4" fill="#fff"/>
    <path d="M9 28.5 H29" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.45"/>
  </g>
</svg>`;

const splash = (bg) => `
<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">
  <rect width="2732" height="2732" fill="${bg}"/>
  <g transform="translate(1366,1366) scale(26) translate(-19,-19)">
    <rect x="1" y="1" width="36" height="36" rx="10" fill="${GREEN}"/>
    <path d="M9 25.5 L16 17 L22 22 L30 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="30" cy="11" r="3.4" fill="#fff"/>
  </g>
</svg>`;

await sharp(Buffer.from(iconCentered)).png().toFile('assets/icon-only.png');
await sharp(Buffer.from(iconCentered)).png().toFile('assets/icon-foreground.png');
await sharp({create:{width:1024,height:1024,channels:4,background:GREEN}}).png().toFile('assets/icon-background.png');
await sharp(Buffer.from(splash(LIGHT_BG))).png().toFile('assets/splash.png');
await sharp(Buffer.from(splash(DARK_BG))).png().toFile('assets/splash-dark.png');
console.log('✓ source artwork written to assets/');
