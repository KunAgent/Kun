use std::sync::Arc;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use kun_collab_server::{CiphertextStore, build_router};
use serde_json::{Value, json};
use tempfile::tempdir;
use tower::ServiceExt;

#[tokio::test]
async fn authenticates_devices_consumes_invites_once_and_ignores_spoofed_member_ids() {
    let directory = tempdir().expect("tempdir");
    let store = Arc::new(
        CiphertextStore::open(directory.path().join("collaboration.sqlite3")).expect("open store"),
    );
    let enrollment = store
        .create_operator_enrollment()
        .expect("create operator enrollment")
        .expect("fresh enrollment token");
    let app = build_router(store.clone());

    let (status, operator) = request(
        &app,
        "POST",
        "/v1/operator/enroll",
        Some(&enrollment),
        json!({
            "memberId": "member-owner",
            "deviceId": "device-owner",
            "displayName": "Owner"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let operator_token = operator["accessToken"].as_str().expect("operator token");

    let (status, _) = request(
        &app,
        "POST",
        "/v1/meetings",
        Some(operator_token),
        json!({ "meetingId": "meeting-1" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, invitation) = request(
        &app,
        "POST",
        "/v1/meetings/meeting-1/invitations",
        Some(operator_token),
        json!({ "role": "member", "expiresInSeconds": 600 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let invitation_id = invitation["invitationId"].as_str().expect("invitation id");
    let invitation_token = invitation["oneTimeCredential"].as_str().expect("invitation token");

    let (status, guest) = request(
        &app,
        "POST",
        &format!("/v1/invitations/{invitation_id}/consume"),
        Some(invitation_token),
        json!({
            "memberId": "member-guest",
            "deviceId": "device-guest",
            "displayName": "Guest",
            "keyPackage": "a2V5LXBhY2thZ2U="
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let guest_token = guest["accessToken"].as_str().expect("guest token");

    let (status, replay) = request(
        &app,
        "POST",
        &format!("/v1/invitations/{invitation_id}/consume"),
        Some(invitation_token),
        json!({
            "memberId": "member-other",
            "deviceId": "device-other",
            "displayName": "Other",
            "keyPackage": "b3RoZXIta2V5LXBhY2thZ2U="
        }),
    )
    .await;
    assert_eq!(status, StatusCode::GONE);
    assert_eq!(replay["code"], "invitation_consumed");

    let (status, _) = request(
        &app,
        "GET",
        "/v1/meetings/meeting-1/events?after=0",
        Some(guest_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, joins) = request(
        &app,
        "GET",
        "/v1/meetings/meeting-1/join-requests",
        Some(operator_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(joins["requests"][0]["keyPackage"], "a2V5LXBhY2thZ2U=");
    assert_eq!(joins["requests"][0]["displayName"], "Guest");

    let (status, _) = request(
        &app,
        "POST",
        &format!("/v1/meetings/meeting-1/join-requests/{invitation_id}/admit"),
        Some(operator_token),
        json!({ "welcome": "d2VsY29tZQ==", "ratchetTree": "cmF0Y2hldC10cmVl", "throughSequence": 0 }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, admission) = request(
        &app,
        "GET",
        &format!("/v1/admissions/{invitation_id}"),
        Some(guest_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(admission["status"], "ready");
    assert_eq!(admission["welcome"], "d2VsY29tZQ==");
    assert_eq!(admission["throughSequence"], 0);

    let (status, _) = request(
        &app,
        "POST",
        "/v1/meetings/meeting-1/commands",
        Some(guest_token),
        json!({
            "meetingId": "meeting-1",
            "commandId": "command-1",
            "memberId": "member-owner",
            "expectedVersion": 0,
            "epoch": 1,
            "frameKind": "mls_application",
            "ciphertext": "b3BhcXVl",
            "ciphertextSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);

    let (status, events) = request(
        &app,
        "GET",
        "/v1/meetings/meeting-1/events?after=0",
        Some(guest_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(events["events"][0]["memberId"], "member-guest");
    assert_eq!(events["events"][0]["frameKind"], "mls_application");

    let (status, invitation) = request(
        &app,
        "POST",
        "/v1/meetings/meeting-1/invitations",
        Some(operator_token),
        json!({ "role": "member", "expiresInSeconds": 600 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let revoked_id = invitation["invitationId"].as_str().expect("revoked invitation id");
    let revoked_token = invitation["oneTimeCredential"].as_str().expect("revoked invitation token");
    let (status, _) = request(
        &app,
        "POST",
        &format!("/v1/meetings/meeting-1/invitations/{revoked_id}/revoke"),
        Some(operator_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, revoked) = request(
        &app,
        "POST",
        &format!("/v1/invitations/{revoked_id}/consume"),
        Some(revoked_token),
        json!({
            "memberId": "member-revoked",
            "deviceId": "device-revoked",
            "displayName": "Revoked",
            "keyPackage": "cmV2b2tlZC1rZXktcGFja2FnZQ=="
        }),
    )
    .await;
    assert_eq!(status, StatusCode::GONE);
    assert_eq!(revoked["code"], "invitation_revoked");

    let (status, _) = request(
        &app,
        "POST",
        "/v1/meetings/meeting-1/members/member-guest/remove",
        Some(operator_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = request(
        &app,
        "GET",
        "/v1/meetings/meeting-1/events?after=0",
        Some(guest_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn rejects_unauthenticated_access_and_removed_members() {
    let directory = tempdir().expect("tempdir");
    let store = Arc::new(
        CiphertextStore::open(directory.path().join("collaboration.sqlite3")).expect("open store"),
    );
    let app = build_router(store);

    let (status, _) = request(
        &app,
        "GET",
        "/v1/meetings/meeting-1/events?after=0",
        None,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

async fn request(
    app: &axum::Router,
    method: &str,
    uri: &str,
    bearer: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if body != Value::Null {
        builder = builder.header("content-type", "application/json");
    }
    let request = builder
        .body(if body == Value::Null {
            Body::empty()
        } else {
            Body::from(body.to_string())
        })
        .expect("request");
    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body");
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).expect("json response")
    };
    (status, value)
}
