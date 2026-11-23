import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type CredentialContext = {
  id: string;
  provider_code: string;
  environment: string;
  scope: string;
  store_id: string | null;
};

const versionPattern = /^v[1-9][0-9]{0,5}$/;

function getKey(version: string) {
  const encoded = versionPattern.test(version)
    ? process.env[`SHIPPING_CREDENTIAL_KEY_${version.toUpperCase()}`]?.trim()
    : undefined;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("KEY_UNAVAILABLE");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("KEY_UNAVAILABLE");
  return key;
}

function associatedData(context: CredentialContext, version: string) {
  return Buffer.from(JSON.stringify([
    "growdesk:shipping", version, context.id, context.provider_code,
    context.environment, context.scope, context.store_id,
  ]));
}

export function encryptShippingToken(token: string, context: CredentialContext) {
  const version = process.env.SHIPPING_CREDENTIAL_ACTIVE_VERSION?.trim() || "v1";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(version), iv);
  cipher.setAAD(associatedData(context, version));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [version, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptShippingToken(ciphertext: string, context: CredentialContext) {
  const [version, encodedIv, encodedTag, data, ...rest] = ciphertext.split(":");
  if (!versionPattern.test(version) || !encodedIv || !encodedTag || !data || rest.length) {
    throw new Error("INVALID_TOKEN");
  }
  const key = getKey(version);
  try {
    const iv = Buffer.from(encodedIv, "base64");
    const tag = Buffer.from(encodedTag, "base64");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("INVALID_TOKEN");
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(associatedData(context, version));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("INVALID_TOKEN");
  }
}
