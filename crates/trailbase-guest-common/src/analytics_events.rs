use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::responses::{ApiResult, bad_request, internal};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnalyticsEventTable {
    pub database: Option<&'static str>,
    pub table: &'static str,
    pub event_name_column: &'static str,
    pub screen_column: Option<&'static str>,
    pub source_column: Option<&'static str>,
    pub payload_json_column: &'static str,
    pub user_id_column: Option<&'static str>,
    pub client_created_at_column: &'static str,
    pub server_received_at_column: &'static str,
    pub request_id_column: Option<&'static str>,
    pub batch_id_column: Option<&'static str>,
}

pub const DEFAULT_ANALYTICS_EVENTS_TABLE: AnalyticsEventTable = AnalyticsEventTable {
    database: Some("analytics"),
    table: "analytics_events",
    event_name_column: "event_name",
    screen_column: Some("screen"),
    source_column: Some("source"),
    payload_json_column: "payload_json",
    user_id_column: Some("user_id"),
    client_created_at_column: "client_created_at",
    server_received_at_column: "server_received_at",
    request_id_column: Some("request_id"),
    batch_id_column: Some("batch_id"),
};

#[derive(Debug, Clone, PartialEq)]
pub struct AnalyticsEventInput<'a> {
    pub event_name: &'a str,
    pub screen: Option<&'a str>,
    pub source: Option<&'a str>,
    pub payload: Option<JsonValue>,
    pub user_id: Option<&'a [u8]>,
    pub client_created_at: i64,
    pub server_received_at: i64,
    pub request_id: Option<&'a str>,
    pub batch_id: Option<&'a str>,
}

impl<'a> AnalyticsEventInput<'a> {
    pub const fn new(event_name: &'a str, client_created_at: i64, server_received_at: i64) -> Self {
        Self {
            event_name,
            screen: None,
            source: None,
            payload: None,
            user_id: None,
            client_created_at,
            server_received_at,
            request_id: None,
            batch_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEventRecord {
    pub event_name: String,
    pub screen: Option<String>,
    pub source: Option<String>,
    pub payload: JsonValue,
    pub user_id: Option<Vec<u8>>,
    pub client_created_at: i64,
    pub server_received_at: i64,
    pub request_id: Option<String>,
    pub batch_id: Option<String>,
}

pub fn insert_analytics_event_tx(
    tx: &mut Transaction,
    table: AnalyticsEventTable,
    input: AnalyticsEventInput<'_>,
) -> ApiResult<AnalyticsEventRecord> {
    let record = normalize_analytics_event_input(table, input)?;
    let (sql, params) = analytics_event_insert_statement(table, &record)?;
    db::tx_execute(tx, &sql, &params)?;
    Ok(record)
}

pub fn insert_analytics_event_batch_tx<'a>(
    tx: &mut Transaction,
    table: AnalyticsEventTable,
    inputs: impl IntoIterator<Item = AnalyticsEventInput<'a>>,
) -> ApiResult<Vec<AnalyticsEventRecord>> {
    let records = normalize_analytics_event_inputs(table, inputs)?;
    for record in &records {
        let (sql, params) = analytics_event_insert_statement(table, record)?;
        db::tx_execute(tx, &sql, &params)?;
    }
    Ok(records)
}

pub fn analytics_event_insert_statement(
    table: AnalyticsEventTable,
    record: &AnalyticsEventRecord,
) -> ApiResult<(String, Vec<Value>)> {
    validate_analytics_event_table(table)?;

    let mut columns = Vec::new();
    let mut values = Vec::new();
    let mut params = Vec::new();

    push_column_value(
        &mut columns,
        &mut values,
        &mut params,
        table.event_name_column,
        Value::Text(record.event_name.clone()),
    );
    if let Some(column) = table.screen_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            text_or_null(record.screen.as_deref()),
        );
    }
    if let Some(column) = table.source_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            text_or_null(record.source.as_deref()),
        );
    }
    push_column_value(
        &mut columns,
        &mut values,
        &mut params,
        table.payload_json_column,
        Value::Text(record.payload.to_string()),
    );
    if let Some(column) = table.user_id_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            record
                .user_id
                .as_ref()
                .map(|value| Value::Blob(value.clone()))
                .unwrap_or(Value::Null),
        );
    }
    push_column_value(
        &mut columns,
        &mut values,
        &mut params,
        table.client_created_at_column,
        Value::Integer(record.client_created_at),
    );
    push_column_value(
        &mut columns,
        &mut values,
        &mut params,
        table.server_received_at_column,
        Value::Integer(record.server_received_at),
    );
    if let Some(column) = table.request_id_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            text_or_null(record.request_id.as_deref()),
        );
    }
    if let Some(column) = table.batch_id_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            text_or_null(record.batch_id.as_deref()),
        );
    }

    Ok((
        format!(
            "INSERT INTO {} ({}) VALUES ({})",
            qualified_table_name(table)?,
            columns.join(", "),
            values.join(", ")
        ),
        params,
    ))
}

pub fn validate_analytics_event_table(table: AnalyticsEventTable) -> ApiResult<()> {
    if let Some(database) = table.database {
        validate_sql_identifier(database, "database")?;
    }
    validate_sql_identifier(table.table, "table")?;
    validate_sql_identifier(table.event_name_column, "event_name_column")?;
    validate_sql_identifier(table.payload_json_column, "payload_json_column")?;
    validate_sql_identifier(table.client_created_at_column, "client_created_at_column")?;
    validate_sql_identifier(table.server_received_at_column, "server_received_at_column")?;
    for (value, label) in [
        (table.screen_column, "screen_column"),
        (table.source_column, "source_column"),
        (table.user_id_column, "user_id_column"),
        (table.request_id_column, "request_id_column"),
        (table.batch_id_column, "batch_id_column"),
    ] {
        if let Some(identifier) = value {
            validate_sql_identifier(identifier, label)?;
        }
    }
    Ok(())
}

fn normalize_analytics_event_inputs<'a>(
    table: AnalyticsEventTable,
    inputs: impl IntoIterator<Item = AnalyticsEventInput<'a>>,
) -> ApiResult<Vec<AnalyticsEventRecord>> {
    inputs
        .into_iter()
        .map(|input| normalize_analytics_event_input(table, input))
        .collect()
}

fn normalize_analytics_event_input(
    table: AnalyticsEventTable,
    input: AnalyticsEventInput<'_>,
) -> ApiResult<AnalyticsEventRecord> {
    validate_analytics_event_table(table)?;

    if table.screen_column.is_none() && input.screen.is_some() {
        return Err(internal(
            "Analytics event screen was provided without a configured screen column",
        ));
    }
    if table.source_column.is_none() && input.source.is_some() {
        return Err(internal(
            "Analytics event source was provided without a configured source column",
        ));
    }
    if table.user_id_column.is_none() && input.user_id.is_some() {
        return Err(internal(
            "Analytics event user_id was provided without a configured user_id column",
        ));
    }
    if table.request_id_column.is_none() && input.request_id.is_some() {
        return Err(internal(
            "Analytics event request_id was provided without a configured request_id column",
        ));
    }
    if table.batch_id_column.is_none() && input.batch_id.is_some() {
        return Err(internal(
            "Analytics event batch_id was provided without a configured batch_id column",
        ));
    }

    let payload = input
        .payload
        .unwrap_or_else(|| JsonValue::Object(Default::default()));
    if !payload.is_object() {
        return Err(bad_request(
            "INVALID_ANALYTICS_EVENT",
            "analytics event payload must be a JSON object",
        ));
    }

    Ok(AnalyticsEventRecord {
        event_name: normalize_required_text(input.event_name, "eventName")?,
        screen: normalize_optional_text(input.screen),
        source: normalize_optional_text(input.source),
        payload,
        user_id: input.user_id.map(|value| value.to_vec()),
        client_created_at: input.client_created_at,
        server_received_at: input.server_received_at,
        request_id: normalize_optional_text(input.request_id),
        batch_id: normalize_optional_text(input.batch_id),
    })
}

fn qualified_table_name(table: AnalyticsEventTable) -> ApiResult<String> {
    validate_analytics_event_table(table)?;
    Ok(match table.database {
        Some(database) => format!("{database}.{}", table.table),
        None => table.table.to_string(),
    })
}

fn push_column_value(
    columns: &mut Vec<&'static str>,
    values: &mut Vec<String>,
    params: &mut Vec<Value>,
    column: &'static str,
    value: Value,
) {
    columns.push(column);
    params.push(value);
    values.push(format!("?{}", params.len()));
}

fn text_or_null(value: Option<&str>) -> Value {
    normalize_optional_text(value)
        .map(Value::Text)
        .unwrap_or(Value::Null)
}

fn normalize_required_text(value: &str, label: &str) -> ApiResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(bad_request(
            "INVALID_ANALYTICS_EVENT",
            format!("{label} must not be empty"),
        ));
    }
    Ok(value.to_string())
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn validate_sql_identifier(identifier: &str, label: &str) -> ApiResult<()> {
    let mut chars = identifier.chars();
    let Some(first) = chars.next() else {
        return Err(internal(format!("{label} must not be empty")));
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return Err(internal(format!("{label} is not a safe SQL identifier")));
    }
    if chars.any(|ch| !(ch == '_' || ch.is_ascii_alphanumeric())) {
        return Err(internal(format!("{label} is not a safe SQL identifier")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_qualified_insert_statement() {
        let record = normalize_analytics_event_input(
            DEFAULT_ANALYTICS_EVENTS_TABLE,
            AnalyticsEventInput {
                event_name: " answer_submit_tapped ",
                screen: Some(" main "),
                source: Some("rn"),
                payload: Some(json!({ "roundNo": 3 })),
                user_id: Some(&[1, 2, 3]),
                client_created_at: 1000,
                server_received_at: 1005,
                request_id: Some(" request-1 "),
                batch_id: Some(" batch-1 "),
            },
        )
        .unwrap();

        let (sql, params) =
            analytics_event_insert_statement(DEFAULT_ANALYTICS_EVENTS_TABLE, &record).unwrap();

        assert_eq!(
            sql,
            "INSERT INTO analytics.analytics_events (event_name, screen, source, payload_json, user_id, client_created_at, server_received_at, request_id, batch_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        );
        assert_eq!(params.len(), 9);
        assert_eq!(record.event_name, "answer_submit_tapped");
        assert_eq!(record.screen.as_deref(), Some("main"));
    }

    #[test]
    fn defaults_missing_payload_to_object() {
        let record = normalize_analytics_event_input(
            DEFAULT_ANALYTICS_EVENTS_TABLE,
            AnalyticsEventInput::new("screen_view", 1, 2),
        )
        .unwrap();

        assert_eq!(record.payload, json!({}));
    }

    #[test]
    fn rejects_empty_event_name() {
        let error = normalize_analytics_event_input(
            DEFAULT_ANALYTICS_EVENTS_TABLE,
            AnalyticsEventInput::new(" ", 1, 2),
        )
        .unwrap_err();

        assert_eq!(error.code, "INVALID_ANALYTICS_EVENT");
    }

    #[test]
    fn rejects_non_object_payload() {
        let error = normalize_analytics_event_input(
            DEFAULT_ANALYTICS_EVENTS_TABLE,
            AnalyticsEventInput {
                payload: Some(json!(["nope"])),
                ..AnalyticsEventInput::new("screen_view", 1, 2)
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "INVALID_ANALYTICS_EVENT");
    }

    #[test]
    fn rejects_unsafe_identifiers() {
        for table in [
            AnalyticsEventTable {
                database: Some("analytics-db"),
                ..DEFAULT_ANALYTICS_EVENTS_TABLE
            },
            AnalyticsEventTable {
                table: "analytics_events;drop",
                ..DEFAULT_ANALYTICS_EVENTS_TABLE
            },
            AnalyticsEventTable {
                event_name_column: "event.name",
                ..DEFAULT_ANALYTICS_EVENTS_TABLE
            },
        ] {
            assert_eq!(
                validate_analytics_event_table(table).unwrap_err().code,
                "INTERNAL"
            );
        }
    }

    #[test]
    fn normalizes_batch_before_inserting() {
        let records = normalize_analytics_event_inputs(
            DEFAULT_ANALYTICS_EVENTS_TABLE,
            [
                AnalyticsEventInput::new("first", 1, 3),
                AnalyticsEventInput::new("second", 2, 4),
            ],
        )
        .unwrap();

        assert_eq!(records[0].event_name, "first");
        assert_eq!(records[1].event_name, "second");
    }
}
