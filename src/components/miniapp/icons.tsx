import type { SVGProps } from "react";

/*
 * Линейные иконки VK Mini App клиники: один размер сетки (24), одна толщина
 * линии, скруглённые концы. Без внешних библиотек и загрузок.
 */
const paths = {
  home: (
    <>
      <path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4.2v-5.2H9.2V20H5a1 1 0 0 1-1-1z" />
    </>
  ),
  doctors: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17 14.6c2 .6 3.2 2.3 3.5 4.9" />
    </>
  ),
  services: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="m9 14.5 2 2 4-4" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2M12 7.9v.2" />
    </>
  ),
  back: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  chevron: <path d="m9.5 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
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
  chat: (
    <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" />
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  ruble: (
    <>
      <path d="M8.5 20V4.5h5a3.75 3.75 0 0 1 0 7.5h-6.5M6.5 16h7" />
    </>
  ),
  slots: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01" />
    </>
  ),
  swap: (
    <>
      <path d="M7 4.5 4 7.5l3 3M4 7.5h12M17 13.5l3 3-3 3M20 16.5H8" />
    </>
  ),
  /* Направления клиники */
  stethoscope: (
    <>
      <path d="M6 3.5v5a4 4 0 0 0 8 0v-5" />
      <path d="M10 12.5v2.5a4.5 4.5 0 0 0 9 0v-2" />
      <circle cx="19" cy="11" r="2" />
    </>
  ),
  tooth: (
    <path d="M7.5 3.8c1.6 0 2.8.9 4.5.9s2.9-.9 4.5-.9c2.3 0 3.6 2 3.4 4.6-.2 2.5-1.4 3.6-1.9 6.2-.5 2.7-.8 5.9-2.4 5.9-1.7 0-1.6-4.5-3.6-4.5s-1.9 4.5-3.6 4.5c-1.6 0-1.9-3.2-2.4-5.9-.5-2.6-1.7-3.7-1.9-6.2-.2-2.6 1.1-4.6 3.4-4.6z" />
  ),
  child: (
    <>
      <circle cx="12" cy="7" r="3" />
      <path d="M7 20.5v-5.5a5 5 0 0 1 10 0v5.5M9.5 20.5V17M14.5 20.5V17" />
    </>
  ),
  ear: (
    <>
      <path d="M7 9.5a5 5 0 0 1 10 0c0 3-2.5 4-2.5 6.5a3 3 0 0 1-5.6 1.5" />
      <path d="M10 10a2 2 0 0 1 4 0c0 1.2-1 1.6-1.5 2.4" />
    </>
  ),
  bone: (
    <path d="M8.2 6.4a2.3 2.3 0 1 0-3.3 2.3l9.9 9.9a2.3 2.3 0 1 0 2.3-3.3 2.3 2.3 0 1 0-3.3-2.3L9.9 9.1a2.3 2.3 0 1 0-1.7-2.7z" />
  ),
  heart: (
    <path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z" />
  ),
  /* Знак «Демо-Мед»: лист. */
  leaf: (
    <>
      <path d="M12 20.5c-4.4-2-7-5.7-7-10 0-2.2.6-4.3 1.6-6 3.4 1 5.4 4.2 5.4 7.6M12 20.5c4.4-2 7-5.7 7-10 0-2.2-.6-4.3-1.6-6-3.4 1-5.4 4.2-5.4 7.6" />
      <path d="M12 12.1v8.4" />
    </>
  ),
} as const;

export type MaIconName = keyof typeof paths;

export function MaIcon({
  name,
  size = 22,
  ...props
}: SVGProps<SVGSVGElement> & { name: MaIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

/** Иконка направления клиники (по id специальности). */
export function specialtyIcon(specialtyId: string | null): MaIconName {
  switch (specialtyId) {
    case "therapist":
      return "stethoscope";
    case "dentist":
      return "tooth";
    case "pediatrician":
      return "child";
    case "ent":
      return "ear";
    case "orthopedist":
      return "bone";
    default:
      return "heart";
  }
}
