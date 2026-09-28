export function StrawberrySticker({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path
        d="M18 7C14 7 8 12 7 19C6 26 13 32 18 34C23 32 30 26 29 19C28 12 22 7 18 7Z"
        fill="#F45876"
        stroke="#5C3A45"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M18 3V8M13 5C15 6.5 17 8 18 8C19 8 21 6.5 23 5M10 8C12 9 16 10 18 10C20 10 24 9 26 8"
        stroke="#7BAE6A"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="13" cy="16" rx="1" ry="1.4" fill="#FFE59E" />
      <ellipse cx="18" cy="18" rx="1" ry="1.4" fill="#FFE59E" />
      <ellipse cx="23" cy="16" rx="1" ry="1.4" fill="#FFE59E" />
      <ellipse cx="15" cy="23" rx="1" ry="1.4" fill="#FFE59E" />
      <ellipse cx="21" cy="23" rx="1" ry="1.4" fill="#FFE59E" />
      <ellipse cx="18" cy="28" rx="0.9" ry="1.2" fill="#FFE59E" />
    </svg>
  );
}

export function LemonSticker({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse
        cx="12"
        cy="12"
        rx="10"
        ry="7"
        transform="rotate(-30 12 12)"
        fill="#F6D56B"
        stroke="#5C3A45"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="4.5" fill="#FFF9DF" stroke="#5C3A45" strokeWidth="1.2" />
      <path d="M12 7.5V16.5M7.5 12H16.5" stroke="#F6D56B" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function WhiskSticker({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20L9 15" stroke="#5C3A45" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M9 15C9 15 11 9 16 6C18.5 4.5 20.5 5.5 20 8C19 13 13 15 9 15Z"
        fill="#F6D56B"
        fillOpacity="0.3"
        stroke="#5C3A45"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="4" cy="20" r="1.5" fill="#F4A7BE" />
    </svg>
  );
}

export function TeacupSticker({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 3C8 4.5 9 5 9 6M12 2C12 3.5 13 4 13 5M16 3C16 4.5 17 5 17 6"
        stroke="#8D5A68"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M5 8H19V14C19 17 16 19 12 19C8 19 5 17 5 14V8Z" fill="#FFFFFF" stroke="#5C3A45" strokeWidth="1.8" />
      <path
        d="M19 10C20.5 10 21.5 11 21.5 12.5C21.5 14 20.5 15 19 15"
        stroke="#5C3A45"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M4 20H20" stroke="#5C3A45" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CookieSticker({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21.35L10.55 20.03C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3C9.24 3 10.91 3.81 12 5.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5C22 12.28 18.6 15.36 13.45 20.04L12 21.35Z"
        fill="#E6A670"
        stroke="#5C3A45"
        strokeWidth="1.8"
      />
      <circle cx="8" cy="8" r="1" fill="#FDE7EE" />
      <circle cx="12" cy="11" r="1.1" fill="#F4A7BE" />
      <circle cx="16" cy="8" r="1" fill="#FFE59E" />
    </svg>
  );
}

export function SendIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 10L16 4L10 16L9 11L4 10Z"
        fill="#5C3A45"
        stroke="#5C3A45"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
