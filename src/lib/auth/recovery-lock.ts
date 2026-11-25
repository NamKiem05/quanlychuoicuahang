export function withRecoveryLock<T>(name: "request" | "update", action: () => Promise<T>) {
  // Browsers with Web Locks also serialize submissions from different tabs.
  return navigator.locks ? navigator.locks.request(`growdesk-password-recovery-${name}`, action) : action();
}
