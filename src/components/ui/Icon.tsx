import type { SVGProps } from "react";

const paths = {
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  home: (
    <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 20.5s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0c0 4.9-6.5 10.5-6.5 10.5z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  phone: (
    <path d="M7 3.5h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 5.5 5.1 1.5 1.5 0 0 1 7 3.5z" />
  ),
  "chevron-left": <path d="M15 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  send: <path d="M20.5 3.5 3.5 10.6l6.4 2.6 2.6 6.4zM9.9 13.2l4.6-4.6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5l1.9 5.1a2 2 0 0 0 1.2 1.2l5.1 1.9-5.1 1.9a2 2 0 0 0-1.2 1.2L12 20l-1.9-5.2a2 2 0 0 0-1.2-1.2L3.8 11.7l5.1-1.9a2 2 0 0 0 1.2-1.2z" />
  ),
  chat: (
    <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" />
  ),
  document: (
    <>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" />
      <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
    </>
  ),
  chart: <path d="M4 20h16M7 16v-4M11.5 16V8M16 16v-6.5" />,
  shield: (
    <>
      <path d="M12 3.5l7 2.5v5.5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  layers: (
    <path d="M12 4l8.5 4.5L12 13 3.5 8.5zM3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
  ),
  heart: (
    <path d="M12 19.5s-7.5-4.4-7.5-10A4 4 0 0 1 12 7.2a4 4 0 0 1 7.5 2.3c0 5.6-7.5 10-7.5 10z" />
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  truck: (
    <>
      <path d="M3.5 6.5h10v9h-10zM13.5 9.5h4l3 3v3h-7" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="17" cy="17.5" r="1.5" />
    </>
  ),
  factory: (
    <path d="M3.5 20V10l5 3V10l5 3V10l5 3V4.5h2V20zM7 16.5h2M11.5 16.5h2M16 16.5h2" />
  ),
  book: (
    <path d="M12 6.5C10 5 7 4.5 4 5v13.5c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5V20" />
  ),
  briefcase: (
    <>
      <path d="M4 8h16v11H4z" />
      <path d="M9 8V5.5h6V8M4 13h16" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.75" />
    </>
  ),
  wrench: (
    <path d="M14.5 4.5a4.5 4.5 0 0 0-4.3 5.9L4.5 16.1a1.9 1.9 0 0 0 2.7 2.7l5.7-5.7a4.5 4.5 0 0 0 5.9-4.3l-2.6 2.6-2.5-.6-.6-2.5z" />
  ),
  lifebuoy: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M6 6l3.5 3.5M14.5 14.5L18 18M18 6l-3.5 3.5M9.5 14.5L6 18" />
    </>
  ),
  utensils: (
    <path d="M7 3.5v7a2 2 0 0 0 2 2v8M5 3.5v5M9 3.5v5M17 20.5v-17c-2 1-3.5 3.5-3.5 7v3h3.5" />
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 19.5c0-3 2.7-5 6-5s6 2 6 5M16 5.5a3 3 0 0 1 0 6M18 14.8c2 .6 3.5 2.2 3.5 4.7" />
    </>
  ),
  calculator: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4M9 14l2 2 4-4" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  size?: number;
};

/** Встроенные иконки. Декоративные по умолчанию (aria-hidden). */
export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
