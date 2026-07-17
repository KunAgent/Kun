use sha2::{Digest, Sha256};

pub fn token_digest(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

pub fn parse_bearer(value: &str) -> Option<&str> {
    value.strip_prefix("Bearer ").filter(|token| token.len() >= 32 && token.len() <= 512)
}
