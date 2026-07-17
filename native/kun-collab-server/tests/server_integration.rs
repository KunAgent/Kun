use std::fs;
use kun_collab_server::{CiphertextCommand, CiphertextStore, ServerError};
use tempfile::tempdir;

#[test]
fn migrates_pre_admission_ciphertext_databases_in_place() {
    let directory = tempdir().expect("tempdir");
    let database = directory.path().join("collaboration.sqlite3");
    let connection = rusqlite::Connection::open(&database).expect("old database");
    connection.execute_batch(r#"
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE meetings(id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE members(meeting_id TEXT, member_id TEXT, role TEXT, status TEXT, PRIMARY KEY(meeting_id, member_id));
        CREATE TABLE invitations(invitation_id TEXT PRIMARY KEY, meeting_id TEXT, credential_digest TEXT, role TEXT, expires_at INTEGER, consumed_at INTEGER, revoked_at INTEGER);
        CREATE TABLE events(meeting_id TEXT, sequence INTEGER, command_id TEXT, member_id TEXT, epoch INTEGER, ciphertext TEXT, ciphertext_sha256 TEXT, receipt_json TEXT, PRIMARY KEY(meeting_id, sequence));
    "#).expect("old schema");
    drop(connection);

    let store = CiphertextStore::open(&database).expect("migrated store");
    drop(store);
    let connection = rusqlite::Connection::open(&database).expect("migrated database");
    connection.prepare("SELECT admission_sequence FROM invitations LIMIT 0").expect("admission column");
    connection.prepare("SELECT frame_kind FROM events LIMIT 0").expect("frame kind column");
}

#[test]
fn sequences_idempotently_and_never_stores_plaintext() {
    let directory = tempdir().expect("tempdir");
    let database = directory.path().join("collaboration.sqlite3");
    let store = CiphertextStore::open(&database).expect("open store");
    store.bootstrap_meeting("meeting-1", "member-owner", "owner").expect("bootstrap");
    let plaintext_canary = "CONFIDENTIAL_RELEASE_PLAN";
    let command = CiphertextCommand {
        meeting_id: "meeting-1".into(),
        command_id: "command-1".into(),
        member_id: "member-owner".into(),
        expected_version: 0,
        epoch: 1,
        frame_kind: "mls_application".into(),
        ciphertext: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, b"opaque bytes only"),
        ciphertext_sha256: "a".repeat(64),
    };

    let first = store.submit(&command).expect("first submit");
    let replay = store.submit(&command).expect("idempotent replay");

    assert_eq!(first.sequence, 1);
    assert!(first.accepted_at.contains('T') && first.accepted_at.ends_with('Z'));
    assert_eq!(replay.sequence, first.sequence);
    assert_eq!(store.events_for("meeting-1", 0).expect("events").len(), 1);
    drop(store);
    let bytes = fs::read(database).expect("database bytes");
    assert!(!bytes.windows(plaintext_canary.len()).any(|window| window == plaintext_canary.as_bytes()));
}

#[test]
fn rejects_non_members_before_allocating_a_sequence() {
    let directory = tempdir().expect("tempdir");
    let store = CiphertextStore::open(directory.path().join("collaboration.sqlite3")).expect("open store");
    store.bootstrap_meeting("meeting-1", "member-owner", "owner").expect("bootstrap");
    let command = CiphertextCommand {
        meeting_id: "meeting-1".into(), command_id: "command-2".into(), member_id: "intruder".into(),
        expected_version: 0, epoch: 1, ciphertext: "b3BhcXVl".into(), ciphertext_sha256: "b".repeat(64)
        , frame_kind: "mls_application".into()
    };

    assert!(matches!(store.submit(&command), Err(ServerError::Forbidden)));
    assert!(store.events_for("meeting-1", 0).expect("events").is_empty());
}
