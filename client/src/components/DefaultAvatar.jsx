const PALETTE = [
  { bg: '#dff3e6', fg: '#2f7d4f' },
  { bg: '#e4e9ff', fg: '#3f52c9' },
  { bg: '#ffe7ec', fg: '#c0395f' },
  { bg: '#fff3d9', fg: '#c98a1c' },
  { bg: '#e9e4ff', fg: '#6a3fc9' },
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// A friendly default stickman avatar. The color palette is picked
// deterministically from the player's name so the same name always looks
// the same, without needing any uploaded image or external asset file.
export default function DefaultAvatar({ seed = '', size = 96 }) {
  const palette = PALETTE[hashString(String(seed)) % PALETTE.length];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="รูปโปรไฟล์เริ่มต้น">
      <rect width="100" height="100" fill={palette.bg} />
      <circle cx="50" cy="36" r="16" fill={palette.fg} />
      <path
        d="M 20 88 C 20 62 34 52 50 52 C 66 52 80 62 80 88 Z"
        fill={palette.fg}
      />
    </svg>
  );
}
