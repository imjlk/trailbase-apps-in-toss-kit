//! Opt-in encryption-key rotation. HMAC lookup secrets are deliberately absent.
//! No Debug/Serialize implementations: keys and plaintext stay server-private.
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use std::collections::BTreeMap;
use trailbase_guest_common::{CommonResult, decode_32_byte_secret};
use trailbase_wasm::rand::get_random_bytes;

const MAX_PLAINTEXT: usize = 8192;
const MAX_SEALED: usize = 16384;
const INVALID: &str = "Invalid or unavailable identity ciphertext";

pub struct TossIdentityKeyRing {
    active_id: String,
    keys: BTreeMap<String, [u8; 32]>,
    legacy_id: Option<String>,
}

impl TossIdentityKeyRing {
    /// Up to eight unique nonsecret IDs; one active writer and optional explicit
    /// legacy v1 reader. Keep each ID permanently bound to its original key.
    pub fn new(
        active_id: &str,
        keys: &[(&str, &str)],
        legacy_v1_id: Option<&str>,
    ) -> CommonResult<Self> {
        if keys.is_empty() || keys.len() > 8 || !key_id(active_id) {
            return Err("Invalid identity key ring configuration".into());
        }
        let mut decoded = BTreeMap::new();
        for (id, secret) in keys {
            if !key_id(id) || decoded.contains_key(*id) {
                return Err("Invalid identity key ring configuration".into());
            }
            let bytes = decode_32_byte_secret(secret)
                .map_err(|_| "Invalid identity key ring key".to_string())?;
            decoded.insert((*id).to_owned(), bytes);
        }
        if !decoded.contains_key(active_id)
            || legacy_v1_id.is_some_and(|id| !decoded.contains_key(id))
        {
            return Err("Identity key ring is missing a configured key".into());
        }
        Ok(Self {
            active_id: active_id.into(),
            keys: decoded,
            legacy_id: legacy_v1_id.map(str::to_owned),
        })
    }

    /// New writes use v2 with an authenticated key ID. Uses a fresh WASI nonce.
    pub fn seal(&self, value: &str) -> CommonResult<String> {
        validate_plaintext(value)?;
        let mut nonce = [0u8; 12];
        get_random_bytes(&mut nonce);
        self.seal_with_nonce(value, nonce)
    }

    /// Reads v2 by exact key ID and v1 only through the configured legacy key.
    /// Never tries other keys after an authentication failure.
    pub fn unseal(&self, sealed: &str) -> CommonResult<String> {
        if sealed.len() > MAX_SEALED {
            return Err(INVALID.into());
        }
        let plaintext = if sealed.starts_with("v1.") {
            let key = self
                .legacy_id
                .as_ref()
                .and_then(|id| self.keys.get(id))
                .ok_or(INVALID)?;
            crate::unseal_toss_user_key(&STANDARD.encode(key), sealed)
                .map_err(|_| INVALID.to_string())?
        } else {
            let (id, nonce, ciphertext) = envelope(sealed)?;
            let key = self.keys.get(id).ok_or(INVALID)?;
            let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| INVALID)?;
            let aad = associated_data(id);
            let plaintext = cipher
                .decrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &ciphertext,
                        aad: aad.as_bytes(),
                    },
                )
                .map_err(|_| INVALID)?;
            String::from_utf8(plaintext).map_err(|_| INVALID)?
        };
        if plaintext.len() > MAX_PLAINTEXT {
            return Err(INVALID.into());
        }
        Ok(plaintext)
    }

    /// Authenticate every row, even one already using the active key. None means
    /// no rewrite. Persist Some using compare-and-swap against the original sealed
    /// value, and advance the private batch cursor in that same transaction.
    pub fn reseal_if_needed(&self, sealed: &str) -> CommonResult<Option<String>> {
        self.reseal_using(sealed, |plaintext| self.seal(plaintext))
    }

    fn reseal_using(
        &self,
        sealed: &str,
        seal: impl FnOnce(&str) -> CommonResult<String>,
    ) -> CommonResult<Option<String>> {
        let plaintext = self.unseal(sealed)?;
        if sealed.starts_with(&format!("v2.{}.", self.active_id)) {
            return Ok(None);
        }
        seal(&plaintext).map(Some)
    }

    fn seal_with_nonce(&self, value: &str, nonce: [u8; 12]) -> CommonResult<String> {
        validate_plaintext(value)?;
        let key = self
            .keys
            .get(&self.active_id)
            .ok_or("Identity writer key unavailable")?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid identity writer key")?;
        let aad = associated_data(&self.active_id);
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: value.as_bytes(),
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| "Identity encryption failed")?;
        Ok(format!(
            "v2.{}.{}.{}",
            self.active_id,
            URL_SAFE_NO_PAD.encode(nonce),
            URL_SAFE_NO_PAD.encode(ciphertext)
        ))
    }
}

fn validate_plaintext(value: &str) -> CommonResult<()> {
    if value.len() > MAX_PLAINTEXT {
        return Err("Identity plaintext exceeds the supported bound".into());
    }
    Ok(())
}
fn key_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || b"_-".contains(&v))
}
fn associated_data(id: &str) -> String {
    format!("trailbase-toss-identity:v2:{id}")
}
fn envelope(sealed: &str) -> CommonResult<(&str, [u8; 12], Vec<u8>)> {
    let mut parts = sealed.split('.');
    if parts.next() != Some("v2") {
        return Err(INVALID.into());
    }
    let id = parts.next().filter(|id| key_id(id)).ok_or(INVALID)?;
    let nonce = URL_SAFE_NO_PAD
        .decode(parts.next().ok_or(INVALID)?)
        .map_err(|_| INVALID)?;
    let nonce: [u8; 12] = nonce.try_into().map_err(|_| INVALID)?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(parts.next().ok_or(INVALID)?)
        .map_err(|_| INVALID)?;
    if parts.next().is_some() || !(16..=MAX_PLAINTEXT + 16).contains(&ciphertext.len()) {
        return Err(INVALID.into());
    }
    Ok((id, nonce, ciphertext))
}

#[cfg(test)]
mod tests {
    use super::*;
    const OLD: &str = "0000000000000000000000000000000000000000000000000000000000000000";
    const NEW: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    fn ring() -> TossIdentityKeyRing {
        TossIdentityKeyRing::new("new", &[("old", OLD), ("new", NEW)], Some("old")).unwrap()
    }

    #[test]
    fn legacy_and_old_v2_reseal_to_current_without_changing_lookup_identity() {
        let ring = ring();
        let old = TossIdentityKeyRing::new("old", &[("old", OLD)], Some("old")).unwrap();
        let hmac = crate::toss_user_key_hmac("synthetic-hmac", "synthetic-user").unwrap();
        for sealed in [
            crate::seal_toss_user_key_with_nonce(OLD, "synthetic-user", [1; 12]).unwrap(),
            old.seal_with_nonce("synthetic-user", [2; 12]).unwrap(),
        ] {
            assert_eq!(ring.unseal(&sealed).unwrap(), "synthetic-user");
            let migrated = ring
                .reseal_using(&sealed, |p| ring.seal_with_nonce(p, [3; 12]))
                .unwrap()
                .unwrap();
            assert!(migrated.starts_with("v2.new."));
            assert_eq!(ring.unseal(&migrated).unwrap(), "synthetic-user");
            assert!(ring.reseal_if_needed(&migrated).unwrap().is_none());
            assert_eq!(
                crate::toss_user_key_hmac("synthetic-hmac", &ring.unseal(&migrated).unwrap())
                    .unwrap(),
                hmac
            );
        }
    }

    #[test]
    fn header_nonce_and_ciphertext_tampering_never_falls_back_to_another_key() {
        // Even equal key bytes cannot make a modified key ID authenticate.
        let ring = TossIdentityKeyRing::new("a", &[("a", OLD), ("b", OLD)], None).unwrap();
        let sealed = ring.seal_with_nonce("PRIVATE-CANARY", [1; 12]).unwrap();
        let mut parts: Vec<_> = sealed.split('.').map(str::to_owned).collect();
        parts[1] = "b".into();
        assert_eq!(ring.unseal(&parts.join(".")).unwrap_err(), INVALID);
        parts[1] = "a".into();
        parts[2] = URL_SAFE_NO_PAD.encode([2u8; 12]);
        assert!(ring.unseal(&parts.join(".")).is_err());
        parts[2] = URL_SAFE_NO_PAD.encode([1u8; 12]);
        parts[3] = URL_SAFE_NO_PAD.encode([0u8; 30]);
        let error = ring.reseal_if_needed(&parts.join(".")).unwrap_err();
        assert_eq!(error, INVALID);
        assert!(!error.contains("PRIVATE-CANARY"));
    }

    #[test]
    fn unknown_retired_and_unconfigured_legacy_keys_fail_closed() {
        let ring = ring();
        let old = TossIdentityKeyRing::new("old", &[("old", OLD)], None).unwrap();
        let sealed = old
            .seal_with_nonce("ait:synthetic-anonymous", [4; 12])
            .unwrap();
        assert_eq!(ring.unseal(&sealed).unwrap(), "ait:synthetic-anonymous");
        let retired = TossIdentityKeyRing::new("new", &[("new", NEW)], None).unwrap();
        assert!(retired.unseal(&sealed).is_err());
        let v1 = crate::seal_toss_user_key_with_nonce(OLD, "synthetic", [5; 12]).unwrap();
        assert!(retired.unseal(&v1).is_err());
        assert!(
            ring.unseal(&sealed.replace("v2.old.", "v2.unknown."))
                .is_err()
        );
    }

    #[test]
    fn configuration_and_envelopes_are_bounded_and_strict() {
        assert!(TossIdentityKeyRing::new("missing", &[("old", OLD)], None).is_err());
        assert!(TossIdentityKeyRing::new("old", &[("old", OLD), ("old", NEW)], None).is_err());
        assert!(TossIdentityKeyRing::new("bad.id", &[("bad.id", OLD)], None).is_err());
        assert!(TossIdentityKeyRing::new("old", &[("old", "PRIVATE-CANARY")], None).is_err());
        assert!(TossIdentityKeyRing::new("old", &[("old", OLD)], Some("missing")).is_err());
        let ring = ring();
        for invalid in [
            "",
            "v3.new.a.b",
            "v2.new.a.b",
            "v2.new...",
            "v2.new.a.b.extra",
        ] {
            assert!(ring.unseal(invalid).is_err());
        }
        assert!(ring.unseal(&"x".repeat(MAX_SEALED + 1)).is_err());
        assert!(
            ring.seal_with_nonce(&"x".repeat(MAX_PLAINTEXT + 1), [6; 12])
                .is_err()
        );
        let sealed = ring
            .seal_with_nonce(&"x".repeat(MAX_PLAINTEXT), [7; 12])
            .unwrap();
        assert_eq!(ring.unseal(&sealed).unwrap().len(), MAX_PLAINTEXT);
    }
}
