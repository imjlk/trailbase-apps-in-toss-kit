use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use rusqlite::{Connection, params_from_iter};
use serde::Deserialize;
use trailbase_wasm::db::Value;

const TEMPLATE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../templates/trailbase/sql");
const MAIN_DATABASE: &str = "main";
const ANALYTICS_DATABASE: &str = "analytics";
static ANALYTICS_DATABASES: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Deserialize)]
pub struct TemplateManifest {
    pub templates: Vec<TemplateEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateEntry {
    pub file: String,
    pub database: String,
    pub kind: TemplateKind,
    #[serde(default)]
    pub upgrades: Option<String>,
    pub requires: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TemplateKind {
    Baseline,
    Upgrade,
}

pub fn template_dir() -> PathBuf {
    Path::new(TEMPLATE_DIR).to_path_buf()
}

pub fn manifest() -> TemplateManifest {
    let path = template_dir().join("manifest.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("parse {}: {err}", path.display()))
}

pub fn template_sql(file: &str) -> String {
    let path = template_dir().join(file);
    std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()))
}

/// Applies `files` plus their manifest `requires`, once each, in manifest order.
pub fn apply_templates(db: &Connection, files: &[&str]) {
    let manifest = manifest();
    for entry in resolve(&manifest, files) {
        db.execute_batch(&template_sql(&entry.file))
            .unwrap_or_else(|err| panic!("apply {}: {err}", entry.file));
    }
}

pub fn user_database() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE _user (id BLOB PRIMARY KEY) STRICT; INSERT INTO _user VALUES (X'01');").unwrap();
    db
}

pub fn database_with(files: &[&str]) -> Connection {
    let db = user_database();
    apply_templates(&db, files);
    db
}

pub fn database() -> Connection {
    database_with(&[
        "message_outbox.core.sql",
        "message_outbox_attempts.sql",
        "iap_orders.sql",
        "promotion_campaigns.sql",
        "promotion_reward_ledger.sql",
    ])
}

/// The fresh main database the WASM smoke migrates: every main baseline template.
pub fn baseline_database() -> Connection {
    let manifest = manifest();
    let files = baseline_files(&manifest, MAIN_DATABASE);
    database_with(&files)
}

/// Attaches a fresh `analytics` database built from the analytics baseline templates.
pub fn attach_analytics_baseline(db: &Connection) {
    let uri = format!(
        "file:kit-analytics-{}?mode=memory&cache=shared",
        ANALYTICS_DATABASES.fetch_add(1, Ordering::Relaxed)
    );
    let analytics = Connection::open(&uri).unwrap();
    let manifest = manifest();
    apply_templates(&analytics, &baseline_files(&manifest, ANALYTICS_DATABASE));
    db.execute("ATTACH DATABASE ?1 AS analytics", [&uri])
        .unwrap();
}

fn baseline_files<'a>(manifest: &'a TemplateManifest, database: &str) -> Vec<&'a str> {
    manifest
        .templates
        .iter()
        .filter(|entry| entry.kind == TemplateKind::Baseline && entry.database == database)
        .map(|entry| entry.file.as_str())
        .collect()
}

fn resolve<'a>(manifest: &'a TemplateManifest, files: &[&str]) -> Vec<&'a TemplateEntry> {
    let mut wanted = HashSet::new();
    let mut pending = files
        .iter()
        .map(|file| file.to_string())
        .collect::<Vec<_>>();
    while let Some(file) = pending.pop() {
        let entry = manifest
            .templates
            .iter()
            .find(|entry| entry.file == file)
            .unwrap_or_else(|| panic!("{file} is not listed in manifest.json"));
        if wanted.insert(entry.file.as_str()) {
            pending.extend(entry.requires.iter().cloned());
        }
    }
    manifest
        .templates
        .iter()
        .filter(|entry| wanted.contains(entry.file.as_str()))
        .collect()
}

fn to_rusqlite_params(params: &[Value]) -> Vec<rusqlite::types::Value> {
    params
        .iter()
        .map(|value| match value {
            Value::Null => rusqlite::types::Value::Null,
            Value::Integer(v) => (*v).into(),
            Value::Real(v) => (*v).into(),
            Value::Text(v) => v.clone().into(),
            Value::Blob(v) => v.clone().into(),
        })
        .collect()
}

fn from_rusqlite_value(value: rusqlite::types::Value) -> Value {
    match value {
        rusqlite::types::Value::Null => Value::Null,
        rusqlite::types::Value::Integer(v) => Value::Integer(v),
        rusqlite::types::Value::Real(v) => Value::Real(v),
        rusqlite::types::Value::Text(v) => Value::Text(v),
        rusqlite::types::Value::Blob(v) => Value::Blob(v),
    }
}

pub fn try_query(
    db: &Connection,
    sql: &str,
    params: &[Value],
) -> rusqlite::Result<Vec<Vec<rusqlite::types::Value>>> {
    let mut statement = db.prepare(sql)?;
    let count = statement.column_count();
    statement
        .query_map(params_from_iter(to_rusqlite_params(params)), |row| {
            (0..count).map(|i| row.get(i)).collect()
        })?
        .collect()
}

pub fn query(db: &Connection, sql: &str, params: &[Value]) -> Vec<Vec<rusqlite::types::Value>> {
    try_query(db, sql, params).unwrap()
}

/// Like `query`, but returns guest `Value`s so row parsers can run on the result.
pub fn query_values(db: &Connection, sql: &str, params: &[Value]) -> Vec<Vec<Value>> {
    query(db, sql, params)
        .into_iter()
        .map(|row| row.into_iter().map(from_rusqlite_value).collect())
        .collect()
}

pub fn execute(db: &Connection, sql: &str, params: &[Value]) -> usize {
    db.execute(sql, params_from_iter(to_rusqlite_params(params)))
        .unwrap()
}

pub fn insert_outbox(db: &Connection, id: &str, status: &str, attempts: i64) {
    db.execute(
        "INSERT INTO message_outbox
        (id,user_id,toss_user_key_hmac,purpose,template_code,payload_json,idempotency_key,
         provider_request_id,status,attempts,not_before_at,locked_at,created_at,updated_at)
        VALUES (?1,X'01','hmac','FUNCTIONAL','reminder','{}',?1,?1,?2,?3,0,10,0,10)",
        rusqlite::params![id, status, attempts],
    )
    .unwrap();
}

fn dangling_foreign_keys(db: &Connection) -> Vec<String> {
    let mut statement = db
        .prepare(
            "SELECT m.name, f.\"table\"
             FROM sqlite_schema m, pragma_foreign_key_list(m.name) f
             WHERE m.type = 'table'
               AND NOT EXISTS (
                 SELECT 1 FROM sqlite_schema t WHERE t.type = 'table' AND t.name = f.\"table\"
               )",
        )
        .unwrap();
    statement
        .query_map([], |row| {
            Ok(format!(
                "{} -> {}",
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

mod tests {
    use super::*;

    #[test]
    fn manifest_lists_every_sql_template_exactly_once() {
        let on_disk = std::fs::read_dir(template_dir())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".sql"))
            .collect::<BTreeSet<_>>();
        let manifest = manifest();
        let mut listed = BTreeSet::new();
        for entry in &manifest.templates {
            assert!(
                listed.insert(entry.file.clone()),
                "{} is listed twice in manifest.json",
                entry.file
            );
        }
        let unlisted = on_disk.difference(&listed).collect::<Vec<_>>();
        assert!(
            unlisted.is_empty(),
            "add these templates to templates/trailbase/sql/manifest.json: {unlisted:?}"
        );
        let missing = listed.difference(&on_disk).collect::<Vec<_>>();
        assert!(
            missing.is_empty(),
            "manifest.json lists templates that do not exist: {missing:?}"
        );
    }

    #[test]
    fn manifest_entries_only_depend_on_earlier_entries() {
        let manifest = manifest();
        for (index, entry) in manifest.templates.iter().enumerate() {
            assert!(
                [MAIN_DATABASE, ANALYTICS_DATABASE].contains(&entry.database.as_str()),
                "{} targets unknown database {}",
                entry.file,
                entry.database
            );
            let earlier = &manifest.templates[..index];
            for required in &entry.requires {
                let dependency = earlier
                    .iter()
                    .find(|candidate| &candidate.file == required)
                    .unwrap_or_else(|| {
                        panic!(
                            "{} requires {required}, which must be listed before it",
                            entry.file
                        )
                    });
                assert_eq!(
                    dependency.database, entry.database,
                    "{} requires {required} from another database",
                    entry.file
                );
                if entry.kind == TemplateKind::Baseline {
                    assert_eq!(
                        dependency.kind,
                        TemplateKind::Baseline,
                        "baseline {} must not require upgrade {required}",
                        entry.file
                    );
                }
            }
            match (entry.kind, entry.upgrades.as_deref()) {
                (TemplateKind::Baseline, None) => {}
                (TemplateKind::Upgrade, Some(target)) => {
                    let target = manifest
                        .templates
                        .iter()
                        .find(|candidate| candidate.file == target)
                        .unwrap_or_else(|| panic!("{} upgrades unknown {target}", entry.file));
                    assert_eq!(target.kind, TemplateKind::Baseline);
                    assert_eq!(target.database, entry.database);
                }
                (kind, upgrades) => panic!("{} is {kind:?} with upgrades {upgrades:?}", entry.file),
            }
        }
    }

    #[test]
    fn each_baseline_template_applies_with_only_its_declared_requirements() {
        let manifest = manifest();
        for entry in manifest
            .templates
            .iter()
            .filter(|entry| entry.kind == TemplateKind::Baseline)
        {
            let db = if entry.database == MAIN_DATABASE {
                user_database()
            } else {
                Connection::open_in_memory().unwrap()
            };
            apply_templates(&db, &[entry.file.as_str()]);
            let dangling = dangling_foreign_keys(&db);
            assert!(
                dangling.is_empty(),
                "{} needs more manifest requires: {dangling:?}",
                entry.file
            );
        }
    }

    #[test]
    fn fresh_baseline_applies_in_manifest_order() {
        let db = baseline_database();
        attach_analytics_baseline(&db);
        assert!(dangling_foreign_keys(&db).is_empty());
        let analytics_tables = query(
            &db,
            "SELECT name FROM analytics.sqlite_schema WHERE type = 'table' ORDER BY name",
            &[],
        );
        assert_eq!(
            analytics_tables,
            vec![
                vec![rusqlite::types::Value::Text("analytics_events".into())],
                vec![rusqlite::types::Value::Text("events".into())],
            ]
        );
    }
}
