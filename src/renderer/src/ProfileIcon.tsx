import type { JSX } from 'react'
import { PROFILE_ICON_IDS, type ProfileIconId } from '../../shared/types'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

const ICONS: Record<Exclude<ProfileIconId, 'letter'>, JSX.Element> = {
  briefcase: (
    <>
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </>
  ),
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10.5V20h12v-9.5" />
    </>
  ),
  building: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M9 7h.01M12 7h.01M15 7h.01M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 19a5 5 0 0 1 5-4" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="10" rx="1.5" />
      <path d="M3 19h18" />
    </>
  ),
  graduation: (
    <>
      <path d="M3 9 12 4l9 5-9 5-9-5z" />
      <path d="M7 12v5c0 1 2.5 3 5 3s5-2 5-3v-5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  star: <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L7.7 20l1-6L4.4 9.9l6-.9L12 3.5z" />,
  heart: (
    <path d="M12 19s-7-4.4-7-9a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 4.6-7 9-7 9z" />
  ),
  bolt: <path d="M13 3 6 14h6l-1 7 7-11h-6l1-7z" />,
  chat: (
    <>
      <path d="M5 16.5A7.5 7.5 0 1 1 12 20H5l1.5-3.5z" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M8 4v4M16 4v4M4 11h16" />
    </>
  ),
  wrench: (
    <path d="M15 8a4 4 0 0 0-5.7-3.6L6 8.7 3.7 6.3 2 8l2.3 2.3L3 12.6l2 2 2.3-1.3L9.6 15.6A4 4 0 0 0 15 8zM14 16l6 6" />
  ),
  coffee: (
    <>
      <path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z" />
      <path d="M16 10h2a3 3 0 0 1 0 6h-2" />
      <path d="M8 4v2M12 4v2" />
    </>
  ),
  book: (
    <>
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5V5.5z" />
      <path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H19" />
    </>
  ),
  shield: <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z" />,
  rocket: (
    <>
      <path d="M12 3c4 3 6 7 6 11l-6 3-6-3c0-4 2-8 6-11z" />
      <path d="M9 20c0-1.5 1.3-3 3-3s3 1.5 3 3" />
      <circle cx="12" cy="11" r="1.5" />
    </>
  ),
  flag: (
    <>
      <path d="M6 3v18" />
      <path d="M6 4h12l-2.5 4L18 12H6" />
    </>
  ),
  leaf: <path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14zM5 19c3-3 6-6 10-8" />,
  moon: <path d="M17 14.5A7 7 0 1 1 10 5a7 7 0 0 0 7 9.5z" />
}

export const ICON_CHOICES = PROFILE_ICON_IDS

export function ProfileIcon({
  id,
  letter,
  size = 16
}: {
  id: ProfileIconId | string
  letter: string
  size?: number
}): JSX.Element {
  if (id === 'letter' || !(id in ICONS)) {
    return <span className="icon-letter">{letter}</span>
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      {...stroke}
    >
      {ICONS[id as Exclude<ProfileIconId, 'letter'>]}
    </svg>
  )
}
