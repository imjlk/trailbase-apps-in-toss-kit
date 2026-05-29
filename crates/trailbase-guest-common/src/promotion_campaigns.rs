use serde::{Deserialize, Serialize};
use trailbase_wasm::db::{Transaction, Value};

use crate::apps_in_toss_proxy::PromotionProviderSignal;
use crate::db;
use crate::responses::ApiResult;
use crate::settings;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromotionCampaignSource {
    Database,
    EnvFallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromotionCampaignUnavailableReason {
    Missing,
    EnvFallbackDisabled,
    Misconfigured,
    NotStarted,
    Ended,
    Paused,
    Exhausted,
    BudgetExhausted,
    CountExhausted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionCampaign {
    pub id: String,
    pub feature_key: String,
    pub provider_promotion_code: Option<String>,
    pub reward_amount: i64,
    pub status: String,
    pub starts_at: Option<i64>,
    pub ends_at: Option<i64>,
    pub budget_limit_amount: Option<i64>,
    pub max_grant_count: Option<i64>,
    pub source: PromotionCampaignSource,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionCampaignUsage {
    pub committed_amount: i64,
    pub committed_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionCampaignResolution {
    pub campaign: Option<PromotionCampaign>,
    pub unavailable_reason: Option<PromotionCampaignUnavailableReason>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotionCampaignLookup<'a> {
    pub feature_key: &'a str,
    pub env_fallback_enabled_key: Option<&'a str>,
    pub env_promotion_code_key: &'a str,
    pub env_reward_amount_key: &'a str,
    pub default_reward_amount: i64,
    pub now_ms: i64,
    pub usage: PromotionCampaignUsage,
}

pub fn resolve_promotion_campaign_tx(
    tx: &mut Transaction,
    lookup: &PromotionCampaignLookup<'_>,
) -> ApiResult<PromotionCampaignResolution> {
    resolve_promotion_campaign_with_amount_tx(tx, lookup, None)
}

pub fn resolve_promotion_campaign_for_amount_tx(
    tx: &mut Transaction,
    lookup: &PromotionCampaignLookup<'_>,
    grant_amount: i64,
) -> ApiResult<PromotionCampaignResolution> {
    resolve_promotion_campaign_with_amount_tx(tx, lookup, Some(grant_amount))
}

fn resolve_promotion_campaign_with_amount_tx(
    tx: &mut Transaction,
    lookup: &PromotionCampaignLookup<'_>,
    grant_amount: Option<i64>,
) -> ApiResult<PromotionCampaignResolution> {
    if promotion_campaigns_table_exists_tx(tx)? {
        let rows = load_campaign_rows_tx(tx, lookup.feature_key)?;
        if !rows.is_empty() {
            let mut temporal_reason = None;
            for row in rows {
                let campaign = campaign_from_row(&row)?;
                let unavailable_reason = match grant_amount {
                    Some(amount) => campaign_unavailable_reason_for_amount(
                        &campaign,
                        lookup.usage,
                        lookup.now_ms,
                        amount,
                    ),
                    None => campaign_unavailable_reason(&campaign, lookup.usage, lookup.now_ms),
                };
                if let Some(reason) = unavailable_reason {
                    if matches!(
                        reason,
                        PromotionCampaignUnavailableReason::NotStarted
                            | PromotionCampaignUnavailableReason::Ended
                    ) {
                        temporal_reason.get_or_insert(reason);
                        continue;
                    }
                    return Ok(PromotionCampaignResolution {
                        campaign: None,
                        unavailable_reason: Some(reason),
                    });
                }
                return Ok(PromotionCampaignResolution {
                    campaign: Some(campaign),
                    unavailable_reason: None,
                });
            }
            return Ok(PromotionCampaignResolution {
                campaign: None,
                unavailable_reason: Some(
                    temporal_reason.unwrap_or(PromotionCampaignUnavailableReason::Missing),
                ),
            });
        }
    }

    Ok(match env_fallback_campaign(lookup) {
        Some(campaign) => {
            let unavailable_reason = match grant_amount {
                Some(amount) => campaign_unavailable_reason_for_amount(
                    &campaign,
                    lookup.usage,
                    lookup.now_ms,
                    amount,
                ),
                None => campaign_unavailable_reason(&campaign, lookup.usage, lookup.now_ms),
            };
            match unavailable_reason {
                Some(reason) => PromotionCampaignResolution {
                    campaign: None,
                    unavailable_reason: Some(reason),
                },
                None => PromotionCampaignResolution {
                    campaign: Some(campaign),
                    unavailable_reason: None,
                },
            }
        }
        None => PromotionCampaignResolution {
            campaign: None,
            unavailable_reason: Some(if env_fallback_enabled(lookup.env_fallback_enabled_key) {
                PromotionCampaignUnavailableReason::Missing
            } else {
                PromotionCampaignUnavailableReason::EnvFallbackDisabled
            }),
        },
    })
}

pub fn campaign_unavailable_reason(
    campaign: &PromotionCampaign,
    usage: PromotionCampaignUsage,
    now_ms: i64,
) -> Option<PromotionCampaignUnavailableReason> {
    campaign_unavailable_reason_for_amount(campaign, usage, now_ms, campaign.reward_amount)
}

pub fn campaign_unavailable_reason_for_amount(
    campaign: &PromotionCampaign,
    usage: PromotionCampaignUsage,
    now_ms: i64,
    grant_amount: i64,
) -> Option<PromotionCampaignUnavailableReason> {
    match campaign.status.trim().to_ascii_uppercase().as_str() {
        "ACTIVE" => {}
        "EXHAUSTED" => return Some(PromotionCampaignUnavailableReason::Exhausted),
        "PAUSED" | "DRAFT" | "ENDED" => return Some(PromotionCampaignUnavailableReason::Paused),
        _ => return Some(PromotionCampaignUnavailableReason::Paused),
    }
    if campaign.source == PromotionCampaignSource::Database
        && (campaign
            .provider_promotion_code
            .as_deref()
            .is_none_or(|code| code.trim().is_empty())
            || campaign.reward_amount <= 0
            || campaign.starts_at.is_none()
            || campaign.ends_at.is_none()
            || campaign.budget_limit_amount.is_none())
    {
        return Some(PromotionCampaignUnavailableReason::Misconfigured);
    }
    if grant_amount <= 0 {
        return Some(PromotionCampaignUnavailableReason::Misconfigured);
    }
    if campaign
        .starts_at
        .is_some_and(|starts_at| starts_at > now_ms)
    {
        return Some(PromotionCampaignUnavailableReason::NotStarted);
    }
    if campaign.ends_at.is_some_and(|ends_at| ends_at <= now_ms) {
        return Some(PromotionCampaignUnavailableReason::Ended);
    }
    if campaign.budget_limit_amount.is_some_and(|limit| {
        usage
            .committed_amount
            .checked_add(grant_amount)
            .map_or(true, |amount| amount > limit)
    }) {
        return Some(PromotionCampaignUnavailableReason::BudgetExhausted);
    }
    if campaign
        .max_grant_count
        .is_some_and(|limit| usage.committed_count + 1 > limit)
    {
        return Some(PromotionCampaignUnavailableReason::CountExhausted);
    }
    None
}

pub fn apply_provider_signal_tx(
    tx: &mut Transaction,
    campaign_id: &str,
    signal: PromotionProviderSignal,
    now: i64,
) -> ApiResult<()> {
    let status = match signal {
        PromotionProviderSignal::Exhausted => "EXHAUSTED",
        PromotionProviderSignal::Paused | PromotionProviderSignal::Misconfigured => "PAUSED",
    };
    db::tx_execute(
        tx,
        "UPDATE promotion_campaigns
         SET status = ?1,
             updated_at = ?2
         WHERE id = ?3",
        &[
            Value::Text(status.to_string()),
            Value::Integer(now),
            Value::Text(campaign_id.to_string()),
        ],
    )?;
    Ok(())
}

pub fn promotion_campaigns_table_exists_tx(tx: &mut Transaction) -> ApiResult<bool> {
    let rows = db::tx_query(
        tx,
        "SELECT COUNT(*)
         FROM sqlite_master
         WHERE type = 'table'
           AND name = 'promotion_campaigns'",
        &[],
    )?;
    Ok(db::integer(&rows[0][0], "promotion_campaigns_table_count")? > 0)
}

fn load_campaign_rows_tx(tx: &mut Transaction, feature_key: &str) -> ApiResult<Vec<Vec<Value>>> {
    db::tx_query(
        tx,
        "SELECT id, feature_key, provider_promotion_code, reward_amount, status,
                starts_at, ends_at, budget_limit_amount, max_grant_count
         FROM promotion_campaigns
         WHERE feature_key = ?1
         ORDER BY
           CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END,
           starts_at DESC,
           created_at DESC
         LIMIT 10",
        &[Value::Text(feature_key.to_string())],
    )
}

fn campaign_from_row(row: &[Value]) -> ApiResult<PromotionCampaign> {
    Ok(PromotionCampaign {
        id: db::text(&row[0], "campaign_id")?,
        feature_key: db::text(&row[1], "feature_key")?,
        provider_promotion_code: db::nullable_text(&row[2])?,
        reward_amount: db::integer(&row[3], "reward_amount")?.max(0),
        status: db::text(&row[4], "status")?,
        starts_at: db::nullable_integer(&row[5])?,
        ends_at: db::nullable_integer(&row[6])?,
        budget_limit_amount: db::nullable_integer(&row[7])?,
        max_grant_count: db::nullable_integer(&row[8])?,
        source: PromotionCampaignSource::Database,
    })
}

fn env_fallback_campaign(lookup: &PromotionCampaignLookup<'_>) -> Option<PromotionCampaign> {
    if !env_fallback_enabled(lookup.env_fallback_enabled_key) {
        return None;
    }
    let provider_promotion_code = settings::string(lookup.env_promotion_code_key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())?;
    Some(PromotionCampaign {
        id: format!("env:{}", lookup.feature_key),
        feature_key: lookup.feature_key.to_string(),
        provider_promotion_code: Some(provider_promotion_code),
        reward_amount: settings::i64_or(lookup.env_reward_amount_key, lookup.default_reward_amount)
            .max(1),
        status: "ACTIVE".to_string(),
        starts_at: None,
        ends_at: None,
        budget_limit_amount: None,
        max_grant_count: None,
        source: PromotionCampaignSource::EnvFallback,
    })
}

fn env_fallback_enabled(key: Option<&str>) -> bool {
    key.and_then(settings::string)
        .map(|value| matches_bool(value.as_str()))
        .unwrap_or(false)
}

fn matches_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "yes" | "y" | "on"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_campaign() -> PromotionCampaign {
        PromotionCampaign {
            id: "campaign-1".to_string(),
            feature_key: "attendance".to_string(),
            provider_promotion_code: Some("promo".to_string()),
            reward_amount: 1,
            status: "ACTIVE".to_string(),
            starts_at: Some(0),
            ends_at: Some(1_000),
            budget_limit_amount: Some(10),
            max_grant_count: None,
            source: PromotionCampaignSource::Database,
        }
    }

    #[test]
    fn campaign_status_controls_availability() {
        let mut campaign = active_campaign();
        assert_eq!(
            campaign_unavailable_reason(&campaign, PromotionCampaignUsage::default(), 100),
            None
        );

        campaign.status = "PAUSED".to_string();
        assert_eq!(
            campaign_unavailable_reason(&campaign, PromotionCampaignUsage::default(), 100),
            Some(PromotionCampaignUnavailableReason::Paused)
        );

        campaign.status = "EXHAUSTED".to_string();
        assert_eq!(
            campaign_unavailable_reason(&campaign, PromotionCampaignUsage::default(), 100),
            Some(PromotionCampaignUnavailableReason::Exhausted)
        );
    }

    #[test]
    fn campaign_window_controls_availability() {
        let mut campaign = active_campaign();
        campaign.starts_at = Some(200);
        assert_eq!(
            campaign_unavailable_reason(&campaign, PromotionCampaignUsage::default(), 100),
            Some(PromotionCampaignUnavailableReason::NotStarted)
        );

        campaign.starts_at = None;
        campaign.ends_at = Some(100);
        campaign.source = PromotionCampaignSource::EnvFallback;
        assert_eq!(
            campaign_unavailable_reason(&campaign, PromotionCampaignUsage::default(), 100),
            Some(PromotionCampaignUnavailableReason::Ended)
        );
    }

    #[test]
    fn campaign_budget_controls_availability() {
        let mut campaign = active_campaign();
        campaign.budget_limit_amount = Some(10);
        assert_eq!(
            campaign_unavailable_reason(
                &campaign,
                PromotionCampaignUsage {
                    committed_amount: 10,
                    committed_count: 0,
                },
                100,
            ),
            Some(PromotionCampaignUnavailableReason::BudgetExhausted)
        );

        campaign.budget_limit_amount = None;
        campaign.source = PromotionCampaignSource::EnvFallback;
        campaign.max_grant_count = Some(3);
        assert_eq!(
            campaign_unavailable_reason(
                &campaign,
                PromotionCampaignUsage {
                    committed_amount: 0,
                    committed_count: 3,
                },
                100,
            ),
            Some(PromotionCampaignUnavailableReason::CountExhausted)
        );
    }

    #[test]
    fn fixed_amount_availability_matches_existing_behavior() {
        let campaign = active_campaign();
        let usage = PromotionCampaignUsage {
            committed_amount: 9,
            committed_count: 0,
        };

        assert_eq!(
            campaign_unavailable_reason(&campaign, usage, 100),
            campaign_unavailable_reason_for_amount(&campaign, usage, 100, campaign.reward_amount)
        );
    }

    #[test]
    fn amount_override_controls_budget_availability() {
        let mut campaign = active_campaign();
        campaign.reward_amount = 1;
        campaign.budget_limit_amount = Some(10);

        assert_eq!(
            campaign_unavailable_reason_for_amount(
                &campaign,
                PromotionCampaignUsage {
                    committed_amount: 8,
                    committed_count: 0,
                },
                100,
                2,
            ),
            None
        );
        assert_eq!(
            campaign_unavailable_reason_for_amount(
                &campaign,
                PromotionCampaignUsage {
                    committed_amount: 8,
                    committed_count: 0,
                },
                100,
                3,
            ),
            Some(PromotionCampaignUnavailableReason::BudgetExhausted)
        );
    }

    #[test]
    fn count_limit_is_independent_from_amount_override() {
        let mut campaign = active_campaign();
        campaign.budget_limit_amount = Some(100);
        campaign.max_grant_count = Some(2);

        assert_eq!(
            campaign_unavailable_reason_for_amount(
                &campaign,
                PromotionCampaignUsage {
                    committed_amount: 0,
                    committed_count: 2,
                },
                100,
                1,
            ),
            Some(PromotionCampaignUnavailableReason::CountExhausted)
        );
    }

    #[test]
    fn amount_override_rejects_non_positive_grant_amount() {
        let campaign = active_campaign();

        assert_eq!(
            campaign_unavailable_reason_for_amount(
                &campaign,
                PromotionCampaignUsage::default(),
                100,
                0,
            ),
            Some(PromotionCampaignUnavailableReason::Misconfigured)
        );
    }

    #[test]
    fn budget_check_treats_overflow_as_exhausted() {
        let mut campaign = active_campaign();
        campaign.budget_limit_amount = Some(i64::MAX);

        assert_eq!(
            campaign_unavailable_reason_for_amount(
                &campaign,
                PromotionCampaignUsage {
                    committed_amount: i64::MAX,
                    committed_count: 0,
                },
                100,
                1,
            ),
            Some(PromotionCampaignUnavailableReason::BudgetExhausted)
        );
    }

    #[test]
    fn database_active_campaign_requires_operational_metadata() {
        let mut campaign = active_campaign();
        campaign.starts_at = None;
        assert_eq!(
            campaign_unavailable_reason(&campaign, PromotionCampaignUsage::default(), 100),
            Some(PromotionCampaignUnavailableReason::Misconfigured)
        );

        campaign = active_campaign();
        campaign.ends_at = None;
        assert_eq!(
            campaign_unavailable_reason(&campaign, PromotionCampaignUsage::default(), 100),
            Some(PromotionCampaignUnavailableReason::Misconfigured)
        );

        campaign = active_campaign();
        campaign.budget_limit_amount = None;
        assert_eq!(
            campaign_unavailable_reason(&campaign, PromotionCampaignUsage::default(), 100),
            Some(PromotionCampaignUnavailableReason::Misconfigured)
        );
    }
}
