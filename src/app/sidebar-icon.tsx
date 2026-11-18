const paths = {
  lock: "M6 10h12v11H6z M8 10V7a4 4 0 1 1 8 0v3 M12 14v3",
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  store: "M3 10v11h18V10 M2 10l2-6h16l2 6 M2 10c0 3 5 3 5 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 5 3 5 0 M9 21v-5h6v5",
  accounts: "M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2",
  admins: "M12 22s7-3.5 7-10V5l-7-3-7 3v7c0 6.5 7 10 7 10z M9 12l2 2 4-4",
  domains: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M2 12h20 M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z",
  orders: "M5 3h14v18l-3-2-4 2-4-2-3 2z M8 8h8 M8 12h8 M8 16h3",
  support: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.5-3A8.5 8.5 0 1 1 21 11.5z M8 12h.01 M12 12h.01 M16 12h.01",
  reviews: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  menu: "M4 3v5a3 3 0 0 0 6 0V3 M7 3v18 M20 3c-3 1-5 5-5 9h5 M20 3v18",
  promotions: "M3 4h8l10 10-7 7L3 10z M7.5 7.5h.01",
  appearance: "M3 4h18v16H3z M3 9h18 M9 9v11",
  settings: "M4 7h7m4 0h5 M4 17h3m4 0h9 M15 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z M11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  search: "M15.5 10a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z M14 14l5 5",
  cart: "M2 3h3l2.4 11h10.8L21 6H6 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  delivery: "M2 4h12v13H2z M14 8h4l4 4v5h-8 M8 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z M20 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  payment: "M3 5h18v14H3z M3 10h18 M6 15h4",
};

export default function SidebarIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="admin-sidebar-icon" aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
