// Subtle chat background pattern - similar to WhatsApp/Telegram
// Uses inline SVG as CSS background for proper tiling across full scroll area

// Light mode SVG pattern
const lightPatternSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60">
  <rect width="60" height="60" fill="#E8E5DE"/>
  <g opacity="0.4">
    <path d="M8 12c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-2l-3 3v-3h-1c-2.2 0-4-1.8-4-4v-4z" fill="none" stroke="#C5C0B6" stroke-width="1"/>
    <circle cx="45" cy="10" r="1.5" fill="#C5C0B6"/>
    <circle cx="50" cy="8" r="1" fill="#C5C0B6"/>
    <circle cx="48" cy="14" r="1" fill="#C5C0B6"/>
    <path d="M30 28c0-1.5 1.2-2.5 2.5-2.5 1 0 1.8.5 2.2 1.3.4-.8 1.2-1.3 2.2-1.3 1.3 0 2.5 1 2.5 2.5 0 2.5-4.7 5-4.7 5s-4.7-2.5-4.7-5z" fill="#C5C0B6"/>
    <path d="M50 45l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5-2.5-2.5 3.5-.5z" fill="none" stroke="#C5C0B6" stroke-width="1"/>
    <path d="M3 40c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2c0 1.1-.9 2-2 2H7l-1.5 1.5V44H5c-1.1 0-2-.9-2-2v-2z" fill="none" stroke="#C5C0B6" stroke-width="0.8"/>
    <circle cx="25" cy="50" r="1" fill="#C5C0B6"/>
    <circle cx="55" cy="30" r="1.2" fill="#C5C0B6"/>
    <circle cx="15" cy="55" r="0.8" fill="#C5C0B6"/>
  </g>
</svg>`;

// Dark mode SVG pattern - subtle dark colors
const darkPatternSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60">
  <rect width="60" height="60" fill="#141415"/>
  <g opacity="0.3">
    <path d="M8 12c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-2l-3 3v-3h-1c-2.2 0-4-1.8-4-4v-4z" fill="none" stroke="#3D3D3F" stroke-width="1"/>
    <circle cx="45" cy="10" r="1.5" fill="#3D3D3F"/>
    <circle cx="50" cy="8" r="1" fill="#3D3D3F"/>
    <circle cx="48" cy="14" r="1" fill="#3D3D3F"/>
    <path d="M30 28c0-1.5 1.2-2.5 2.5-2.5 1 0 1.8.5 2.2 1.3.4-.8 1.2-1.3 2.2-1.3 1.3 0 2.5 1 2.5 2.5 0 2.5-4.7 5-4.7 5s-4.7-2.5-4.7-5z" fill="#3D3D3F"/>
    <path d="M50 45l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5-2.5-2.5 3.5-.5z" fill="none" stroke="#3D3D3F" stroke-width="1"/>
    <path d="M3 40c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2c0 1.1-.9 2-2 2H7l-1.5 1.5V44H5c-1.1 0-2-.9-2-2v-2z" fill="none" stroke="#3D3D3F" stroke-width="0.8"/>
    <circle cx="25" cy="50" r="1" fill="#3D3D3F"/>
    <circle cx="55" cy="30" r="1.2" fill="#3D3D3F"/>
    <circle cx="15" cy="55" r="0.8" fill="#3D3D3F"/>
  </g>
</svg>`;

// Encode the SVGs for use in CSS
const encodedLightSvg = encodeURIComponent(lightPatternSvg);
const encodedDarkSvg = encodeURIComponent(darkPatternSvg);

// Export as CSS style objects
export const chatBackgroundStyle: React.CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,${encodedLightSvg}")`,
  backgroundRepeat: 'repeat',
};

export const chatBackgroundStyleDark: React.CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,${encodedDarkSvg}")`,
  backgroundRepeat: 'repeat',
};
