use std::sync::OnceLock;

use serde_json::Value;

use crate::responses::{ApiResult, internal};

static SETTINGS: OnceLock<Option<Value>> = OnceLock::new();

pub fn required(name: &str) -> ApiResult<String> {
    string(name).ok_or_else(|| internal(format!("{name} is not configured")))
}

pub fn string(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            settings_json()
                .and_then(|json| json.get(name))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .filter(|value| !value.is_empty())
        })
}

pub fn string_or(name: &str, default: &str) -> String {
    string(name).unwrap_or_else(|| default.to_string())
}

pub fn i64_or(name: &str, default: i64) -> i64 {
    string(name)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(default)
}

fn settings_json() -> Option<&'static Value> {
    SETTINGS
        .get_or_init(|| {
            std::fs::read_to_string("/settings.json")
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        })
        .as_ref()
}
