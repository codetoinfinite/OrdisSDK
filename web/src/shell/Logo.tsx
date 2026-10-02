/** AlpheSDK mark: a raised amber tile with a snow-capped peak whose notch makes an "A". */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="6" width="60" height="56" rx="14" fill="#C97A00" />
      <rect x="2" y="2" width="60" height="56" rx="14" fill="#F6A019" />
      <path
        d="M14.5 46.5 32 15 49.5 46.5H38.5L32 35.5 25.5 46.5Z"
        fill="#23251D"
        stroke="#23251D"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M32 15 26.1 25.6 29 24 32 27 35 24 37.9 25.6Z"
        fill="#FDFDF8"
        stroke="#FDFDF8"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="49" cy="15.5" r="4" fill="#FDFDF8" />
    </svg>
  );
}
