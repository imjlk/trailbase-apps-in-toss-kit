use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::responses::{ApiResult, bad_request, internal};

pub const DEFAULT_DOMAIN_EVENT_LIMIT: i64 = 80;
pub const MAX_DOMAIN_EVENT_LIMIT: i64 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DomainEventTable {
    pub table: &'static str,
    pub user_id_column: Option<&'static str>,
    pub event_name_column: &'static str,
    pub metadata_json_column: &'static str,
    pub source_type_column: Option<&'static str>,
    pub source_id_json_column: Option<&'static str>,
    pub request_id_column: Option<&'static str>,
    pub created_at_column: &'static str,
}

impl DomainEventTable {
    pub const fn user_history(
        table: &'static str,
        user_id_column: &'static str,
        event_name_column: &'static str,
        metadata_json_column: &'static str,
        created_at_column: &'static str,
    ) -> Self {
        Self {
            table,
            user_id_column: Some(user_id_column),
            event_name_column,
            metadata_json_column,
            source_type_column: None,
            source_id_json_column: None,
            request_id_column: None,
            created_at_column,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DomainEventInput<'a> {
    pub user_id: Option<&'a str>,
    pub event_name: &'a str,
    pub metadata: Option<JsonValue>,
    pub source_type: Option<&'a str>,
    pub source_id: Option<JsonValue>,
    pub request_id: Option<&'a str>,
    pub created_at: i64,
}

impl<'a> DomainEventInput<'a> {
    pub const fn new(event_name: &'a str, created_at: i64) -> Self {
        Self {
            user_id: None,
            event_name,
            metadata: None,
            source_type: None,
            source_id: None,
            request_id: None,
            created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainEventRecord {
    pub user_id: Option<String>,
    pub event_name: String,
    pub metadata: JsonValue,
    pub source_type: Option<String>,
    pub source_id: Option<JsonValue>,
    pub request_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DomainEventListQuery<'a> {
    pub user_id: Option<&'a str>,
    pub limit: i64,
}

impl<'a> DomainEventListQuery<'a> {
    pub const fn for_user(user_id: &'a str) -> Self {
        Self {
            user_id: Some(user_id),
            limit: DEFAULT_DOMAIN_EVENT_LIMIT,
        }
    }
}

pub fn insert_domain_event_tx(
    tx: &mut Transaction,
    table: DomainEventTable,
    input: DomainEventInput<'_>,
) -> ApiResult<DomainEventRecord> {
    let record = normalize_domain_event_input(table, input)?;
    let (sql, params) = domain_event_insert_statement(table, &record)?;
    db::tx_execute(tx, &sql, &params)?;
    Ok(record)
}

pub fn list_domain_events_tx(
    tx: &mut Transaction,
    table: DomainEventTable,
    query: DomainEventListQuery<'_>,
) -> ApiResult<Vec<DomainEventRecord>> {
    let (sql, params) = domain_event_select_statement(table, query)?;
    let rows = db::tx_query(tx, &sql, &params)?;
    rows.iter()
        .map(|row| domain_event_record_from_row(table, row))
        .collect()
}

pub fn normalize_domain_event_input(
    table: DomainEventTable,
    input: DomainEventInput<'_>,
) -> ApiResult<DomainEventRecord> {
    validate_domain_event_table(table)?;

    if table.user_id_column.is_none() && input.user_id.is_some() {
        return Err(internal(
            "Domain event user_id was provided without a configured user_id column",
        ));
    }
    if table.source_type_column.is_none() && input.source_type.is_some() {
        return Err(internal(
            "Domain event source_type was provided without a configured source_type column",
        ));
    }
    if table.source_id_json_column.is_none() && input.source_id.is_some() {
        return Err(internal(
            "Domain event source_id was provided without a configured source_id_json column",
        ));
    }
    if table.request_id_column.is_none() && input.request_id.is_some() {
        return Err(internal(
            "Domain event request_id was provided without a configured request_id column",
        ));
    }

    Ok(DomainEventRecord {
        user_id: normalize_optional_text(input.user_id),
        event_name: normalize_required_text(input.event_name, "eventName")?,
        metadata: input
            .metadata
            .unwrap_or_else(|| JsonValue::Object(Default::default())),
        source_type: normalize_optional_text(input.source_type),
        source_id: input.source_id,
        request_id: normalize_optional_text(input.request_id),
        created_at: input.created_at,
    })
}

pub fn domain_event_insert_statement(
    table: DomainEventTable,
    record: &DomainEventRecord,
) -> ApiResult<(String, Vec<Value>)> {
    validate_domain_event_table(table)?;

    let mut columns = Vec::new();
    let mut values = Vec::new();
    let mut params = Vec::new();

    if let Some(column) = table.user_id_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            text_or_null(record.user_id.as_deref()),
        );
    }
    push_column_value(
        &mut columns,
        &mut values,
        &mut params,
        table.event_name_column,
        Value::Text(record.event_name.clone()),
    );
    push_column_value(
        &mut columns,
        &mut values,
        &mut params,
        table.metadata_json_column,
        Value::Text(record.metadata.to_string()),
    );
    if let Some(column) = table.source_type_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            text_or_null(record.source_type.as_deref()),
        );
    }
    if let Some(column) = table.source_id_json_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            record
                .source_id
                .as_ref()
                .map(|value| Value::Text(value.to_string()))
                .unwrap_or(Value::Null),
        );
    }
    if let Some(column) = table.request_id_column {
        push_column_value(
            &mut columns,
            &mut values,
            &mut params,
            column,
            text_or_null(record.request_id.as_deref()),
        );
    }
    push_column_value(
        &mut columns,
        &mut values,
        &mut params,
        table.created_at_column,
        Value::Integer(record.created_at),
    );

    Ok((
        format!(
            "INSERT INTO {} ({}) VALUES ({})",
            table.table,
            columns.join(", "),
            values.join(", ")
        ),
        params,
    ))
}

pub fn domain_event_select_statement(
    table: DomainEventTable,
    query: DomainEventListQuery<'_>,
) -> ApiResult<(String, Vec<Value>)> {
    validate_domain_event_table(table)?;
    let limit = normalize_limit(query.limit)?;

    if query.user_id.is_some() && table.user_id_column.is_none() {
        return Err(internal(
            "Domain event user filter requires a configured user_id column",
        ));
    }

    let mut columns = vec![
        table.event_name_column,
        table.metadata_json_column,
        table.created_at_column,
    ];
    if let Some(column) = table.user_id_column {
        columns.push(column);
    }
    if let Some(column) = table.source_type_column {
        columns.push(column);
    }
    if let Some(column) = table.source_id_json_column {
        columns.push(column);
    }
    if let Some(column) = table.request_id_column {
        columns.push(column);
    }

    let mut params = Vec::new();
    let where_clause = if let (Some(column), Some(user_id)) = (table.user_id_column, query.user_id)
    {
        params.push(Value::Text(user_id.to_string()));
        format!(" WHERE {column} = ?{}", params.len())
    } else {
        String::new()
    };
    params.push(Value::Integer(limit));

    Ok((
        format!(
            "SELECT {} FROM {}{} ORDER BY {} DESC LIMIT ?{}",
            columns.join(", "),
            table.table,
            where_clause,
            table.created_at_column,
            params.len()
        ),
        params,
    ))
}

pub fn validate_domain_event_table(table: DomainEventTable) -> ApiResult<()> {
    validate_sql_identifier(table.table, "table")?;
    validate_sql_identifier(table.event_name_column, "event_name_column")?;
    validate_sql_identifier(table.metadata_json_column, "metadata_json_column")?;
    validate_sql_identifier(table.created_at_column, "created_at_column")?;
    for (value, label) in [
        (table.user_id_column, "user_id_column"),
        (table.source_type_column, "source_type_column"),
        (table.source_id_json_column, "source_id_json_column"),
        (table.request_id_column, "request_id_column"),
    ] {
        if let Some(identifier) = value {
            validate_sql_identifier(identifier, label)?;
        }
    }
    Ok(())
}

fn domain_event_record_from_row(
    table: DomainEventTable,
    row: &[Value],
) -> ApiResult<DomainEventRecord> {
    let mut index = 0;
    let event_name = db::text(&row[index], "event_name")?;
    index += 1;
    let metadata_json = db::text(&row[index], "metadata_json")?;
    index += 1;
    let created_at = db::integer(&row[index], "created_at")?;
    index += 1;
    let user_id = if table.user_id_column.is_some() {
        let value = db::nullable_text(&row[index])?;
        index += 1;
        value
    } else {
        None
    };
    let source_type = if table.source_type_column.is_some() {
        let value = db::nullable_text(&row[index])?;
        index += 1;
        value
    } else {
        None
    };
    let source_id = if table.source_id_json_column.is_some() {
        let value = db::nullable_text(&row[index])?;
        index += 1;
        value
            .map(|text| parse_json_text(&text, "source_id_json"))
            .transpose()?
    } else {
        None
    };
    let request_id = if table.request_id_column.is_some() {
        db::nullable_text(&row[index])?
    } else {
        None
    };

    Ok(DomainEventRecord {
        user_id,
        event_name,
        metadata: parse_json_text(&metadata_json, "metadata_json")?,
        source_type,
        source_id,
        request_id,
        created_at,
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
            "INVALID_DOMAIN_EVENT",
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

fn normalize_limit(limit: i64) -> ApiResult<i64> {
    if limit <= 0 {
        return Err(bad_request(
            "INVALID_DOMAIN_EVENT_QUERY",
            "domain event limit must be positive",
        ));
    }
    Ok(limit.min(MAX_DOMAIN_EVENT_LIMIT))
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

fn parse_json_text(value: &str, label: &str) -> ApiResult<JsonValue> {
    serde_json::from_str(value).map_err(|err| internal(format!("Invalid {label}: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const BASIC_TABLE: DomainEventTable = DomainEventTable::user_history(
        "app_events",
        "user_id",
        "event_name",
        "metadata_json",
        "created_at",
    );

    const FULL_TABLE: DomainEventTable = DomainEventTable {
        table: "app_events",
        user_id_column: Some("user_id"),
        event_name_column: "event_name",
        metadata_json_column: "metadata_json",
        source_type_column: Some("source_type"),
        source_id_json_column: Some("source_id_json"),
        request_id_column: Some("request_id"),
        created_at_column: "created_at",
    };

    #[test]
    fn builds_basic_insert_statement() {
        let record = normalize_domain_event_input(
            BASIC_TABLE,
            DomainEventInput {
                user_id: Some("user-1"),
                event_name: " collect_click ",
                metadata: Some(json!({ "screen": "home" })),
                source_type: None,
                source_id: None,
                request_id: None,
                created_at: 123,
            },
        )
        .unwrap();

        let (sql, params) = domain_event_insert_statement(BASIC_TABLE, &record).unwrap();

        assert_eq!(
            sql,
            "INSERT INTO app_events (user_id, event_name, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4)"
        );
        assert_eq!(params.len(), 4);
        assert_eq!(record.event_name, "collect_click");
        assert_eq!(record.metadata["screen"], "home");
    }

    #[test]
    fn builds_full_insert_statement_with_optional_dimensions() {
        let record = normalize_domain_event_input(
            FULL_TABLE,
            DomainEventInput {
                user_id: Some("user-1"),
                event_name: "mission_claim",
                metadata: Some(json!({ "amount": 1 })),
                source_type: Some("mission"),
                source_id: Some(json!("daily-1")),
                request_id: Some("request-1"),
                created_at: 456,
            },
        )
        .unwrap();

        let (sql, params) = domain_event_insert_statement(FULL_TABLE, &record).unwrap();

        assert_eq!(
            sql,
            "INSERT INTO app_events (user_id, event_name, metadata_json, source_type, source_id_json, request_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        );
        assert_eq!(params.len(), 7);
    }

    #[test]
    fn builds_user_scoped_select_statement() {
        let (sql, params) = domain_event_select_statement(
            FULL_TABLE,
            DomainEventListQuery {
                user_id: Some("user-1"),
                limit: 20,
            },
        )
        .unwrap();

        assert_eq!(
            sql,
            "SELECT event_name, metadata_json, created_at, user_id, source_type, source_id_json, request_id FROM app_events WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        );
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn caps_select_limit() {
        let (sql, params) = domain_event_select_statement(
            BASIC_TABLE,
            DomainEventListQuery {
                user_id: None,
                limit: 5_000,
            },
        )
        .unwrap();

        assert_eq!(
            sql,
            "SELECT event_name, metadata_json, created_at, user_id FROM app_events ORDER BY created_at DESC LIMIT ?1"
        );
        assert!(matches!(
            params.last(),
            Some(Value::Integer(MAX_DOMAIN_EVENT_LIMIT))
        ));
    }

    #[test]
    fn rejects_empty_event_name() {
        let error =
            normalize_domain_event_input(BASIC_TABLE, DomainEventInput::new(" ", 123)).unwrap_err();
        assert_eq!(error.code, "INVALID_DOMAIN_EVENT");
    }

    #[test]
    fn rejects_unsafe_identifiers() {
        let error = validate_domain_event_table(DomainEventTable {
            table: "app_events;drop",
            ..BASIC_TABLE
        })
        .unwrap_err();
        assert_eq!(error.code, "INTERNAL");
    }
}
