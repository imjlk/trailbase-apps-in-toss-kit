#[test]
fn bootstrap_copy_in_template_matches_library() {
    assert_eq!(
        include_str!("../src/bootstrap_timing.rs"),
        include_str!("../../../templates/trailbase/bootstrap_timing.rs")
    );
}
