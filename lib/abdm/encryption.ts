import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const HKDF_INFO = new TextEncoder().encode("docpad-abdm-fhir-x25519-v1");
const HKDF_SALT = new Uint8Array(0);

function u8ToB64(u8: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type AbdmX25519EncryptedPayload = {
  version: 1;
  algorithm: "X25519-HKDF-SHA256-AES256GCM";
  ephemeralPublicKeyB64: string;
  ivB64: string;
  ciphertextB64: string;
};

/**
 * Decode a 32-byte Curve25519 / X25519 public key from standard base64.
 */
export function decodeX25519PublicKeyFromBase64(b64: string): Uint8Array {
  const raw = b64ToU8(b64.trim());
  if (raw.length !== 32) {
    throw new Error(`X25519 public key must be 32 bytes (got ${raw.length})`);
  }
  return raw;
}

async function aesGcmEncrypt(aesKey32: Uint8Array, plaintext: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const gcm = globalThis.crypto?.subtle;
  if (!gcm) {
    throw new Error("Web Crypto (crypto.subtle) is required for AES-GCM");
  }
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const key = await gcm.importKey("raw", aesKey32.buffer.slice(aesKey32.byteOffset, aesKey32.byteOffset + aesKey32.byteLength) as ArrayBuffer, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
  ]);
  const ct = await gcm.encrypt({ name: "AES-GCM", iv }, key, plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer);
  return { iv, ciphertext: new Uint8Array(ct) };
}

/**
 * X25519 ECDH + HKDF-SHA256 + AES-256-GCM for UTF-8 FHIR JSON (ABDM HI transfer style).
 *
 * @param plaintextUtf8 — canonical JSON string of a FHIR Bundle
 * @param recipientPublicKey32 — 32-byte X25519 public key (HIU / gateway)
 */
export async function encryptFhirBundleUtf8(
  plaintextUtf8: string,
  recipientPublicKey32: Uint8Array,
): Promise<AbdmX25519EncryptedPayload> {
  if (recipientPublicKey32.length !== 32) {
    throw new Error("recipientPublicKey32 must be 32 bytes");
  }

  const ephemeralSecret = x25519.utils.randomSecretKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const shared = x25519.getSharedSecret(ephemeralSecret, recipientPublicKey32);

  const aesKey = hkdf(sha256, shared, HKDF_SALT, HKDF_INFO, 32);

  const plainBytes = new TextEncoder().encode(plaintextUtf8);
  const { iv, ciphertext } = await aesGcmEncrypt(aesKey, plainBytes);

  return {
    version: 1,
    algorithm: "X25519-HKDF-SHA256-AES256GCM",
    ephemeralPublicKeyB64: u8ToB64(ephemeralPublic),
    ivB64: u8ToB64(iv),
    ciphertextB64: u8ToB64(ciphertext),
  };
}

/**
 * Convenience: encrypt from base64-encoded recipient X25519 public key.
 */
export async function encryptFhirBundleUtf8WithRecipientKeyB64(
  plaintextUtf8: string,
  recipientPublicKeyBase64: string,
): Promise<AbdmX25519EncryptedPayload> {
  return encryptFhirBundleUtf8(plaintextUtf8, decodeX25519PublicKeyFromBase64(recipientPublicKeyBase64));
}
