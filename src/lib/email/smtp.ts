import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { resolve4 } from "node:dns/promises";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";

export type SmtpSettings = { smtp_host: string; smtp_port: number; smtp_username: string; password_ciphertext: string; sender_email: string; sender_name: string };
function key() {
  const input = process.env.SMTP_SETTINGS_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(input)) throw new Error("Cần cấu hình SMTP_SETTINGS_ENCRYPTION_KEY bằng 32 byte mã hóa base64 trên máy chủ.");
  const value = Buffer.from(input, "base64");
  if (value.length !== 32) throw new Error("Khóa mã hóa SMTP không hợp lệ.");
  return value;
}
export function encryptSmtpPassword(password: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}
function decryptSmtpPassword(value: string) {
  const [version, iv, tag, data] = value.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Không thể giải mã mật khẩu SMTP.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
export async function readSmtpSettings() {
  const admin = createAdminClient();
  const result = await admin.from("platform_email_settings").select("smtp_host, smtp_port, smtp_username, password_ciphertext, sender_email, sender_name").eq("id", true).maybeSingle();
  if (result.error) throw result.error;
  return result.data as SmtpSettings | null;
}
function publicIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a,b,c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export async function makeSmtpTransport(settings: SmtpSettings) {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(settings.smtp_host) || ![465, 587, 2525].includes(settings.smtp_port)) throw new Error("Máy chủ SMTP hoặc cổng không hợp lệ.");
  const addresses = await resolve4(settings.smtp_host);
  if (!addresses.length || addresses.some((address) => !publicIpv4(address))) throw new Error("Máy chủ SMTP phải có địa chỉ Internet công khai.");
  const transporter = nodemailer.createTransport({ host: addresses[0], port: settings.smtp_port, secure: settings.smtp_port === 465, requireTLS: settings.smtp_port !== 465, tls: { servername: settings.smtp_host }, auth: { user: settings.smtp_username, pass: decryptSmtpPassword(settings.password_ciphertext) }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
  return { transporter, from: { name: settings.sender_name, address: settings.sender_email } };
}
export async function applicationMailer() {
  let settings: SmtpSettings | null;
  try { settings = await readSmtpSettings(); } catch (error) {
    // Existing installations may not have the optional email settings migration yet.
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if ((code === "42P01" || code === "PGRST205" || !process.env.SUPABASE_SERVICE_ROLE_KEY) && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return legacyMailer();
    throw new Error("Chưa cấu hình email.");
  }
  if (settings) return makeSmtpTransport(settings);
  return legacyMailer();
}
function legacyMailer() {
  const user = process.env.GMAIL_USER?.trim(), pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!user || !pass) throw new Error("Chưa cấu hình email.");
  return { transporter: nodemailer.createTransport({ service: "gmail", auth: { user, pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 }), from: { name: "GrowDesk", address: user } };
}
