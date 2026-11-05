const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const Check = () => <svg {...p}><path d="M3 8.5l3.2 3L13 4.5" /></svg>;
export const Alert = () => <svg {...p}><path d="M8 3v6M8 12.2v.1" /></svg>;
export const Cross = () => <svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const Link = () => <svg {...p}><path d="M6.5 3.5H4A1.5 1.5 0 002.5 5v7A1.5 1.5 0 004 13.5h7A1.5 1.5 0 0012.5 12V9.5M9 2.5h4.5V7M13.5 2.5L7.5 8.5" /></svg>;
export const Plus = () => <svg {...p}><path d="M8 3v10M3 8h10" /></svg>;
export const Mark = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
    <rect x="1" y="11" width="26" height="6" rx="1" fill="var(--rail)" />
    <rect x="1" y="11" width="15" height="6" rx="1" fill="var(--signal)" />
    <circle cx="16" cy="14" r="5" fill="var(--paper)" stroke="var(--signal)" strokeWidth="2.5" />
  </svg>
);
