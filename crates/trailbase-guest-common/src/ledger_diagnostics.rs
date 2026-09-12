//! Stable inquiry fingerprints for ledger records. These are not authorization
//! tokens. Only pass an order/outbox/promotion record ID, never a Toss user key.
use sha2::{Digest, Sha256};

use crate::responses::{ApiResult, bad_request};

#[derive(Clone, Copy)]
pub enum LedgerKind {
    Iap,
    Promotion,
    Message,
}

impl LedgerKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Iap => "iap",
            Self::Promotion => "promotion",
            Self::Message => "message",
        }
    }
}

/// Match the private operator CLI's diagnostic ID without exposing the record ID.
/// Ownership checks belong in the authenticated consumer endpoint that returns it.
pub fn ledger_diagnostic_id(kind: LedgerKind, record_id: &str) -> ApiResult<String> {
    if record_id.is_empty()
        || record_id.trim() != record_id
        || record_id.len() > 512
        || record_id.chars().any(|c| c.is_control() || c == '\u{feff}')
    {
        return Err(bad_request("INVALID_RECORD_ID", "invalid ledger record ID"));
    }
    let kind = kind.as_str();
    let mut digest = Sha256::new();
    digest.update(b"kit-ledger-diagnostic-v1\0");
    digest.update(kind.as_bytes());
    digest.update(b"\0");
    digest.update(record_id.as_bytes());
    Ok(format!(
        "kitdiag1.{kind}.{}",
        hex::encode(digest.finalize())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_ids_are_domain_separated_and_reject_invalid_input() {
        let iap = ledger_diagnostic_id(LedgerKind::Iap, "order-1").unwrap();
        assert_eq!(
            iap,
            "kitdiag1.iap.3b17ba35799d1a0fd2148f040b2a7965dd284dc78a6c3dbb399090d43bb3abfc"
        );
        assert_eq!(
            ledger_diagnostic_id(LedgerKind::Message, "요청-1").unwrap(),
            "kitdiag1.message.0b8bdba2356c1b1fdf57322178b5e106339583e2148c512062a2061ef62a8965"
        );
        assert_ne!(
            iap,
            ledger_diagnostic_id(LedgerKind::Message, "order-1").unwrap()
        );
        assert!(!iap.contains("order-1"));
        for invalid in [
            "",
            " order-1",
            "order-1\n",
            "a\0b",
            "a\u{0085}b",
            "\u{feff}order",
        ] {
            assert!(ledger_diagnostic_id(LedgerKind::Iap, invalid).is_err());
        }
        assert!(ledger_diagnostic_id(LedgerKind::Iap, &"a".repeat(513)).is_err());
    }
}
