import sharp from 'sharp';
const og=`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f9d5c"/><stop offset="0.55" stop-color="#15824a"/><stop offset="1" stop-color="#0f5f37"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- subtle rising chart motif -->
  <path d="M0 470 L240 430 L420 470 L640 360 L860 400 L1060 250 L1200 300" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="10" stroke-linecap="round"/>
  <!-- logo tile -->
  <g transform="translate(96,150)">
    <rect x="0" y="0" width="120" height="120" rx="30" fill="#0f5f37"/>
    <g transform="translate(60,60) scale(2.0) translate(-19,-19)">
      <path d="M9 25.5 L16 17 L22 22 L30 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="30" cy="11" r="3.4" fill="#fff"/>
    </g>
  </g>
  <text x="248" y="208" font-family="Georgia, 'Times New Roman', serif" font-size="74" font-weight="800" fill="#ffffff" letter-spacing="-2">Gameweek Edge</text>
  <text x="250" y="258" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#bff0d4" letter-spacing="3">FPL, WITH AN EDGE</text>
  <text x="98" y="350" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#ffffff">The calm, clear edge for Fantasy</text>
  <text x="98" y="404" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#ffffff">Premier League managers.</text>
  <text x="98" y="476" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="500" fill="#d9f3e4">predicted points · graded in public · live rank · rival intelligence</text>
</svg>`;
await sharp(Buffer.from(og)).png().toFile('icons/og.png');
console.log('✓ og.png generated (1200x630)');
