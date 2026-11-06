/**
 * ALAMA LOGO
 * ==========
 *
 * The Alama brand mark: an amber "A" (alama = sign / mark / symbol in Swahili)
 * with a seal dot beneath it. Renders on a transparent background so it works
 * on both light and dark surfaces. Use `public/alama-icon.svg` (shielded
 * version) for favicons and the Electron window icon.
 *
 * Props:
 * - size   : CSS size applied to width/height (default 24)
 * - fill   : mark colour (default amber-500 #F59E0B)
 * - className : extra Tailwind classes
 */

const ALAMA_AMBER = '#F59E0B';

const AlamaLogo = ({ size = 24, fill = ALAMA_AMBER, className }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Alama"
    role="img"
  >
    <path
      stroke={fill}
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      d="M13 24 L16 7 L19 24"
    />
    <path
      stroke={fill}
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
      d="M13.8 15.4 L18.2 15.4"
    />
    <circle cx="16" cy="27.5" r="1.6" fill={fill} />
  </svg>
);

AlamaLogo.displayName = 'AlamaLogo';

export default AlamaLogo;
