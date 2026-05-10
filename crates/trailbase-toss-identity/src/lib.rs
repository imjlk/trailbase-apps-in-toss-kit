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
    let mut nonce = [0u8; 12];
    get_random_bytes(&mut nonce);
    seal_toss_user_key_with_nonce(encryption_key, toss_user_key, nonce)
}

fn seal_toss_user_key_with_nonce(
    encryption_key: &str,
    toss_user_key: &str,
    nonce: [u8; 12],
) -> CommonResult<String> {
    let key_bytes = decode_32_byte_secret(encryption_key)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|err| format!("invalid Toss encryption key: {err}"))?;
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

#[cfg(test)]
fn hmac_and_seal_with_nonce(
    secrets: &TossIdentitySecrets,
    toss_user_key: &str,
    nonce: [u8; 12],
) -> CommonResult<SealedTossUserKey> {
    Ok(SealedTossUserKey {
        hmac: toss_user_key_hmac(&secrets.hmac_secret, toss_user_key)?,
        sealed: seal_toss_user_key_with_nonce(&secrets.encryption_key, toss_user_key, nonce)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "0000000000000000000000000000000000000000000000000000000000000000";
    const OTHER_KEY: &str = "1111111111111111111111111111111111111111111111111111111111111111";

    #[test]
    fn hmac_and_seal_round_trips_toss_user_key() {
        let secrets = TossIdentitySecrets {
            hmac_secret: "hmac-secret".to_string(),
            encryption_key: KEY.to_string(),
        };

        let sealed = hmac_and_seal_with_nonce(&secrets, "toss-user-key", [3u8; 12]).unwrap();

        assert_eq!(
            sealed.hmac,
            toss_user_key_hmac(&secrets.hmac_secret, "toss-user-key").unwrap()
        );
        assert_ne!(sealed.sealed, "toss-user-key");
        assert_eq!(
            unseal_toss_user_key(&secrets.encryption_key, &sealed.sealed).unwrap(),
            "toss-user-key"
        );
    }

    #[test]
    fn unseal_rejects_wrong_key() {
        let sealed = seal_toss_user_key_with_nonce(KEY, "toss-user-key", [3u8; 12]).unwrap();
        let error = unseal_toss_user_key(OTHER_KEY, &sealed).unwrap_err();

        assert!(error.contains("Toss userKey unsealing failed"));
    }

    #[test]
    fn unseal_rejects_malformed_payloads() {
        assert_eq!(
            unseal_toss_user_key(KEY, "not-v1").unwrap_err(),
            "unsupported sealed Toss userKey format"
        );
        assert_eq!(
            unseal_toss_user_key(KEY, "v1.only-one-part").unwrap_err(),
            "invalid sealed Toss userKey format"
        );
        assert_eq!(
            unseal_toss_user_key(KEY, "v1.AQID.AQID").unwrap_err(),
            "sealed Toss nonce must be 12 bytes"
        );
    }
}
