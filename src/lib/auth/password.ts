export const minimumPasswordLength = 8;
export const maximumPasswordBytes = 72;

export function passwordStrength(password: string) {
  if (!password) return 0;
  return Math.max(1, [
    password.length >= minimumPasswordLength,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^\w]|_/.test(password) && password.length >= minimumPasswordLength,
  ].filter(Boolean).length);
}

export function validateRecoveryPassword(password: string, confirmation: string) {
  if (password.length < minimumPasswordLength) return `Mật khẩu cần có ít nhất ${minimumPasswordLength} ký tự.`;
  if (new TextEncoder().encode(password).length > maximumPasswordBytes) {
    return `Mật khẩu không được vượt quá ${maximumPasswordBytes} byte.`;
  }
  if (password !== confirmation) return "Hai mật khẩu chưa khớp.";
  return null;
}
