use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedPrincipal {
    pub member_id: String,
    pub device_id: String,
    pub is_operator: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCredential {
    pub member_id: String,
    pub device_id: String,
    pub access_token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInvitation {
    pub invitation_id: String,
    pub meeting_id: String,
    pub role: String,
    pub one_time_credential: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingJoinRequest {
    pub invitation_id: String,
    pub meeting_id: String,
    pub member_id: String,
    pub device_id: String,
    pub display_name: String,
    pub role: String,
    pub key_package: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionRecord {
    pub status: String,
    pub meeting_id: String,
    pub welcome: Option<String>,
    pub ratchet_tree: Option<String>,
    pub through_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CiphertextCommand {
    pub meeting_id: String,
    pub command_id: String,
    pub member_id: String,
    pub expected_version: u64,
    pub epoch: u64,
    pub frame_kind: String,
    pub ciphertext: String,
    pub ciphertext_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedReceipt {
    pub command_id: String,
    pub meeting_id: String,
    pub sequence: u64,
    pub accepted_at: String,
    pub server_instance_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CiphertextEvent {
    pub receipt: SignedReceipt,
    pub member_id: String,
    pub epoch: u64,
    pub frame_kind: String,
    pub ciphertext: String,
    pub ciphertext_sha256: String,
}
