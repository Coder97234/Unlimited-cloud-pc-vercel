// Orbit's private-edition mark: a one-eyed compass with a loose orbital ring
// and a folded corner. Static, inline artwork; no external image requests.
export function EarlyOrbit() {
  return <svg aria-hidden="true" focusable="false" className="early-orbit" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path className="early-orbit-ring" d="M12 67c10 19 64 15 73-10M14 37c9-17 61-23 71-4" stroke="currentColor" strokeWidth="1.15" strokeDasharray="2 4" strokeLinecap="round" />
    <path d="M14 37v10m-5-5h10m60 26v10m-5-5h10" stroke="#c16e40" strokeWidth="1.55" strokeLinecap="round" />
    <path d="M32 66c-4 8-4 12-9 14m39-14c4 6 4 10 10 13m-45-26c-8 4-13 2-16-1m57 1c10 3 16-3 17-9" stroke="var(--mascot-outline,#463127)" strokeWidth="2.15" strokeLinecap="round" />
    <path d="M46.4 23.5c.8-1.4 2.5-1.4 3.4 0l26 43.5c.8 1.35-.1 3-1.7 3H21.8c-1.55 0-2.5-1.7-1.7-3z" fill="#efb66d" stroke="var(--mascot-outline,#463127)" strokeWidth="2.2" strokeLinejoin="round" />
    <path d="M47 26 25 65h3l21-36z" fill="#ffde93" opacity=".92" />
    <path d="m63 48 11.8 20H47.5z" fill="#b46b57" />
    <path d="m63 48-15.5 20m13-14 4 7" stroke="#ffdfab" strokeWidth=".9" opacity=".75" strokeLinecap="round" />
    <ellipse cx="45" cy="21" rx="16.2" ry="4.6" transform="rotate(-18 45 21)" stroke="#a9573c" strokeWidth="1.65" />
    <path d="m53 10 1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4L48 15l3.4-1.6z" fill="#a95b55" stroke="#f9ce8d" strokeWidth=".7" />
    <g className="early-orbit-eye">
      <path d="M32 48q15.5-16.5 32 0-16 16-32 0Z" fill="#fff7dc" stroke="#422d25" strokeWidth="1.5" />
      <ellipse cx="49" cy="48" rx="3.7" ry="6.1" fill="#3d2a25" /><circle cx="50" cy="46" r="1.25" fill="#fff9e5" />
    </g>
    <path d="m46 57 1.9 4.1L52 63l-4.1 1.9L46 69l-1.9-4.1L40 63l4.1-1.9z" fill="#fff4db" stroke="#a86047" strokeWidth=".8" /><circle cx="46" cy="63" r="1.25" fill="#ae6464" />
    <path d="M33 84c7 1.8 23 1.8 30 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity=".24" />
  </svg>;
}
