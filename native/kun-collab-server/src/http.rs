use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;

use crate::{CiphertextCommand, CiphertextStore, ServerError, auth::parse_bearer};

struct AppState {
    store: Arc<CiphertextStore>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrollRequest {
    member_id: String,
    device_id: String,
    display_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinRequest {
    member_id: String,
    device_id: String,
    display_name: String,
    key_package: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdmissionRequest {
    welcome: String,
    ratchet_tree: String,
    through_sequence: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeetingRequest {
    meeting_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvitationRequest {
    role: String,
    expires_in_seconds: u64,
}

#[derive(Deserialize)]
struct EventsQuery {
    after: Option<u64>,
}

pub fn build_router(store: Arc<CiphertextStore>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/operator/enroll", post(enroll_operator))
        .route("/v1/meetings", post(create_meeting))
        .route("/v1/meetings/{meeting_id}/invitations", post(create_invitation))
        .route("/v1/meetings/{meeting_id}/invitations/{invitation_id}/revoke", post(revoke_invitation))
        .route("/v1/invitations/{invitation_id}/consume", post(consume_invitation))
        .route("/v1/admissions/{invitation_id}", get(get_admission))
        .route("/v1/meetings/{meeting_id}/join-requests", get(list_join_requests))
        .route("/v1/meetings/{meeting_id}/join-requests/{invitation_id}/admit", post(admit_join_request))
        .route("/v1/meetings/{meeting_id}/members/{member_id}/remove", post(remove_member))
        .route("/v1/meetings/{meeting_id}/commands", post(submit_command))
        .route("/v1/meetings/{meeting_id}/events", get(list_events))
        .with_state(Arc::new(AppState { store }))
}

async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "protocol": 1,
        "serverInstanceId": state.store.server_instance_id(),
        "receiptVerifyingKey": state.store.receipt_verifying_key(),
    }))
}

async fn enroll_operator(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<EnrollRequest>,
) -> impl IntoResponse {
    let token = match bearer(&headers) {
        Ok(token) => token,
        Err(error) => return server_error(error),
    };
    match state.store.enroll_operator(
        token,
        &request.member_id,
        &request.device_id,
        &request.display_name,
    ) {
        Ok(credential) => (StatusCode::CREATED, Json(serde_json::to_value(credential).unwrap())).into_response(),
        Err(error) => server_error(error),
    }
}

async fn list_join_requests(
    State(state): State<Arc<AppState>>,
    Path(meeting_id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    match state.store.pending_join_requests(&principal, &meeting_id) {
        Ok(requests) => (StatusCode::OK, Json(serde_json::json!({ "requests": requests }))).into_response(),
        Err(error) => server_error(error),
    }
}

async fn admit_join_request(
    State(state): State<Arc<AppState>>,
    Path((meeting_id, invitation_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(request): Json<AdmissionRequest>,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    match state.store.admit_join_request(
        &principal,
        &meeting_id,
        &invitation_id,
        &request.welcome,
        &request.ratchet_tree,
        request.through_sequence,
    ) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => server_error(error),
    }
}

async fn get_admission(
    State(state): State<Arc<AppState>>,
    Path(invitation_id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    match state.store.admission_for(&principal, &invitation_id) {
        Ok(admission) => {
            let status = if admission.status == "ready" { StatusCode::OK } else { StatusCode::ACCEPTED };
            (status, Json(serde_json::to_value(admission).unwrap())).into_response()
        }
        Err(error) => server_error(error),
    }
}

async fn create_meeting(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<MeetingRequest>,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    match state.store.create_meeting(&principal, &request.meeting_id) {
        Ok(()) => (StatusCode::CREATED, Json(serde_json::json!({ "meetingId": request.meeting_id }))).into_response(),
        Err(error) => server_error(error),
    }
}

async fn create_invitation(
    State(state): State<Arc<AppState>>,
    Path(meeting_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<InvitationRequest>,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    match state.store.create_invitation(&principal, &meeting_id, &request.role, request.expires_in_seconds) {
        Ok(invitation) => (StatusCode::CREATED, Json(serde_json::to_value(invitation).unwrap())).into_response(),
        Err(error) => server_error(error),
    }
}

async fn consume_invitation(
    State(state): State<Arc<AppState>>,
    Path(invitation_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<JoinRequest>,
) -> impl IntoResponse {
    let token = match bearer(&headers) {
        Ok(token) => token,
        Err(error) => return server_error(error),
    };
    match state.store.consume_invitation(
        &invitation_id,
        token,
        &request.member_id,
        &request.device_id,
        &request.display_name,
        &request.key_package,
    ) {
        Ok(credential) => (StatusCode::CREATED, Json(serde_json::to_value(credential).unwrap())).into_response(),
        Err(error) => server_error(error),
    }
}

async fn revoke_invitation(
    State(state): State<Arc<AppState>>,
    Path((meeting_id, invitation_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    match state.store.revoke_invitation(&principal, &meeting_id, &invitation_id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => server_error(error),
    }
}

async fn remove_member(
    State(state): State<Arc<AppState>>,
    Path((meeting_id, member_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    match state.store.remove_member(&principal, &meeting_id, &member_id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => server_error(error),
    }
}

async fn submit_command(
    State(state): State<Arc<AppState>>,
    Path(meeting_id): Path<String>,
    headers: HeaderMap,
    Json(mut command): Json<CiphertextCommand>,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    if command.meeting_id != meeting_id {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "code": "meeting_mismatch" }))).into_response();
    }
    command.meeting_id = meeting_id;
    match state.store.submit_as(&principal, &command) {
        Ok(receipt) => (StatusCode::ACCEPTED, Json(serde_json::to_value(receipt).unwrap())).into_response(),
        Err(error) => server_error(error),
    }
}

async fn list_events(
    State(state): State<Arc<AppState>>,
    Path(meeting_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<EventsQuery>,
) -> impl IntoResponse {
    let principal = match authenticate(&state.store, &headers) {
        Ok(principal) => principal,
        Err(error) => return server_error(error),
    };
    match state.store.events_for_as(&principal, &meeting_id, query.after.unwrap_or(0)) {
        Ok(events) => (StatusCode::OK, Json(serde_json::json!({ "events": events }))).into_response(),
        Err(error) => server_error(error),
    }
}

fn bearer(headers: &HeaderMap) -> Result<&str, ServerError> {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_bearer)
        .ok_or(ServerError::Unauthorized)
}

fn authenticate(
    store: &CiphertextStore,
    headers: &HeaderMap,
) -> Result<crate::AuthenticatedPrincipal, ServerError> {
    store.authenticate(bearer(headers)?)
}

fn server_error(error: ServerError) -> axum::response::Response {
    let (status, code) = match &error {
        ServerError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
        ServerError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
        ServerError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
        ServerError::InvitationConsumed => (StatusCode::GONE, "invitation_consumed"),
        ServerError::InvitationExpired => (StatusCode::GONE, "invitation_expired"),
        ServerError::InvitationRevoked => (StatusCode::GONE, "invitation_revoked"),
        ServerError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
        ServerError::InvalidCommand(_) => (StatusCode::BAD_REQUEST, "invalid_command"),
        ServerError::Storage(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
    };
    (status, Json(serde_json::json!({ "code": code, "message": error.to_string() }))).into_response()
}
