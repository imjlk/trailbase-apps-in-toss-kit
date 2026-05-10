use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use trailbase_guest_common::{CommonResult, decode_32_byte_secret, hmac_sha256_hex};
use trailbase_wasm::rand::get_random_bytes;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TossIdentitySecrets {
    pub hmac_secret: String,
    pub encryption_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SealedTossUserKey {
    pub hmac: String,
    pub sealed: String,
}

pub fn toss_user_key_hmac(secret: &str, toss_user_key: &str) -> CommonResult<String> {
    hmac_sha256_hex(secret, toss_user_key)
}

pub fn seal_toss_user_key(encryption_key: &str, toss_user_key: &str) -> CommonResult<String> {
    let key_bytes = decode_32_byte_secret(encryption_key)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|err| format!("invalid Toss encryption key: {err}"))?;
    let mut nonce = [0u8; 12];
    get_random_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), toss_user_key.as_bytes())
        .map_err(|err| format!("Toss userKey sealing failed: {err}"))?;
    Ok(format!(
        "v1.{}.{}",
        URL_SAFE_NO_PAD.encode(nonce),
        URL_SAFE_NO_PAD.encode(ciphertext)
    ))
}

pub fn unseal_toss_user_key(encryption_key: &str, sealed: &str) -> CommonResult<String> {
    let key_bytes = decode_32_byte_secret(encryption_key)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|err| format!("invalid Toss encryption key: {err}"))?;
    let rest = sealed
        .strip_prefix("v1.")
        .ok_or_else(|| "unsupported sealed Toss userKey format".to_string())?;
    let (nonce_text, ciphertext_text) = rest
        .split_once('.')
        .ok_or_else(|| "invalid sealed Toss userKey format".to_string())?;
    let nonce = URL_SAFE_NO_PAD
        .decode(nonce_text)
        .map_err(|err| format!("invalid sealed Toss nonce: {err}"))?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(ciphertext_text)
        .map_err(|err| format!("invalid sealed Toss ciphertext: {err}"))?;
    if nonce.len() != 12 {
        return Err("sealed Toss nonce must be 12 bytes".to_string());
    }
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|err| format!("Toss userKey unsealing failed: {err}"))?;
    String::from_utf8(plaintext).map_err(|err| format!("sealed Toss userKey was not UTF-8: {err}"))
}

pub fn hmac_and_seal(
    secrets: &TossIdentitySecrets,
    toss_user_key: &str,
) -> CommonResult<SealedTossUserKey> {
    Ok(SealedTossUserKey {
        hmac: toss_user_key_hmac(&secrets.hmac_secret, toss_user_key)?,
        sealed: seal_toss_user_key(&secrets.encryption_key, toss_user_key)?,
    })
}
