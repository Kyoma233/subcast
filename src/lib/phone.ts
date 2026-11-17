import { useEffect, useState } from "react";

/** Phones (the Android build, and a narrow desktop window) get the drawer + full-screen panel layout. */
export const PHONE_QUERY = "(max-width: 760px)";

const mq = () => (typeof window === "undefined" ? null : window.matchMedia(PHONE_QUERY));

/** Sets `html.phone`, which drives the phone layout in styles.css. Call once before the app renders. */
export function applyPhoneClass() {
  const m = mq();
  if (!m) return;
  const put = () => document.documentElement.classList.toggle("phone", m.matches);
  put();
  m.addEventListener("change", put);
}

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => mq()?.matches ?? false);
  useEffect(() => {
    const m = mq();
    if (!m) return;
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}
