//! Privacy-safe, opt-in bootstrap diagnostics. Copy-in consumers may own this module.
//! No account data, URLs, errors or tokens are accepted by this API.
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Prepare,
    TransactionOpen,
    Transaction,
    Auth,
    Response,
}

impl Stage {
    fn index(self) -> usize {
        self as usize
    }
    fn label(self) -> &'static str {
        match self {
            Self::Prepare => "prepare",
            Self::TransactionOpen => "transaction_open",
            Self::Transaction => "transaction",
            Self::Auth => "auth",
            Self::Response => "response",
        }
    }
}

/// One line is emitted on drop, including early-return failures. Durations are
/// monotonic and additive; transaction includes commit and auth includes rotation.
/// Never interpret auth_ms as just network time or transaction_open_ms as pure lock wait.
pub struct BootstrapTiming {
    clock: Option<Instant>,
    last_ms: u128,
    durations: [u128; 5],
    stage: Stage,
    success: bool,
}

impl BootstrapTiming {
    pub fn new(enabled: bool) -> Self {
        Self {
            clock: enabled.then(Instant::now),
            last_ms: 0,
            durations: [0; 5],
            stage: Stage::Prepare,
            success: false,
        }
    }

    pub fn transaction_starting(&mut self) {
        self.advance(Stage::TransactionOpen);
    }
    pub fn transaction_opened(&mut self) {
        self.advance(Stage::Transaction);
    }
    pub fn transaction_committed(&mut self) {
        self.advance(Stage::Auth);
    }
    pub fn auth_finished(&mut self) {
        self.advance(Stage::Response);
    }
    pub fn succeeded(&mut self) {
        self.success = true;
    }

    fn advance(&mut self, next: Stage) {
        if let Some(clock) = self.clock {
            self.record(clock.elapsed().as_millis());
        }
        self.stage = next;
    }
    fn record(&mut self, elapsed_ms: u128) {
        self.durations[self.stage.index()] += elapsed_ms.saturating_sub(self.last_ms);
        self.last_ms = self.last_ms.max(elapsed_ms);
    }
    fn line(&self) -> String {
        format!(
            "bootstrap_timing status={} last_stage={} prepare_ms={} transaction_open_ms={} transaction_ms={} auth_ms={} response_ms={} total_ms={}",
            if self.success { "ok" } else { "error" },
            self.stage.label(),
            self.durations[0],
            self.durations[1],
            self.durations[2],
            self.durations[3],
            self.durations[4],
            self.last_ms,
        )
    }
}

impl Drop for BootstrapTiming {
    fn drop(&mut self) {
        if let Some(clock) = self.clock {
            self.record(clock.elapsed().as_millis());
            // Best effort: a closed log stream must not turn a successful login into a trap.
            use std::io::Write;
            let _ = writeln!(std::io::stderr().lock(), "{}", self.line());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_does_not_read_clock_or_accumulate() {
        let mut timing = BootstrapTiming::new(false);
        timing.transaction_starting();
        timing.transaction_opened();
        timing.transaction_committed();
        timing.auth_finished();
        timing.succeeded();
        assert!(timing.clock.is_none());
        assert_eq!(timing.durations, [0; 5]);
    }

    #[test]
    fn stages_include_commit_and_rotation_without_double_counting() {
        let mut t = BootstrapTiming::new(false);
        t.record(2);
        t.stage = Stage::TransactionOpen;
        t.record(10);
        t.stage = Stage::Transaction;
        t.record(30);
        t.stage = Stage::Auth;
        t.record(75);
        t.stage = Stage::Response;
        t.record(76);
        t.succeeded();
        assert_eq!(t.durations, [2, 8, 20, 45, 1]);
        assert_eq!(t.durations.iter().sum::<u128>(), t.last_ms);
        assert_eq!(
            t.line(),
            "bootstrap_timing status=ok last_stage=response prepare_ms=2 transaction_open_ms=8 transaction_ms=20 auth_ms=45 response_ms=1 total_ms=76"
        );
    }

    #[test]
    fn early_failure_identifies_last_stage_without_error_payload() {
        let mut t = BootstrapTiming::new(false);
        t.stage = Stage::Auth;
        t.record(12);
        assert!(
            t.line()
                .starts_with("bootstrap_timing status=error last_stage=auth ")
        );
        assert!(!t.line().contains("token"));
    }
}
