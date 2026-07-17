use std::{path::Path, sync::Mutex};
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use rand::{RngCore, rngs::OsRng};
use rusqlite::{Connection, OptionalExtension, params};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;
use crate::{
    AdmissionRecord, AuthenticatedPrincipal, CiphertextCommand, CiphertextEvent,
    DeviceCredential, PendingJoinRequest, ServerInvitation, SignedReceipt, auth, rbac,
};

const MAX_CIPHERTEXT_CHARS: usize = 1_398_104;

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("authentication required")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("resource not found")]
    NotFound,
    #[error("invitation has already been consumed")]
    InvitationConsumed,
    #[error("invitation has expired")]
    InvitationExpired,
    #[error("invitation has been revoked")]
    InvitationRevoked,
    #[error("optimistic version conflict: current version is {0}")]
    Conflict(u64),
    #[error("invalid ciphertext command: {0}")]
    InvalidCommand(String),
    #[error("storage error: {0}")]
    Storage(String),
}

impl From<rusqlite::Error> for ServerError {
    fn from(value: rusqlite::Error) -> Self { Self::Storage(value.to_string()) }
}

pub struct CiphertextStore {
    connection: Mutex<Connection>,
    signing_key: SigningKey,
    server_instance_id: String,
}

impl CiphertextStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, ServerError> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(SCHEMA)?;
        migrate_schema(&connection)?;
        let server_instance_id = read_or_create_text(&connection, "server_instance_id", || Uuid::new_v4().to_string())?;
        let signing_key = read_or_create_signing_key(&connection)?;
        Ok(Self { connection: Mutex::new(connection), signing_key, server_instance_id })
    }

    pub fn bootstrap_meeting(&self, meeting_id: &str, member_id: &str, role: &str) -> Result<(), ServerError> {
        let connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        connection.execute(
            "INSERT OR IGNORE INTO meetings(id, version) VALUES (?1, 0)",
            params![meeting_id],
        )?;
        connection.execute(
            "INSERT INTO members(meeting_id, member_id, role, status) VALUES (?1, ?2, ?3, 'active')
             ON CONFLICT(meeting_id, member_id) DO UPDATE SET role=excluded.role, status='active'",
            params![meeting_id, member_id, role],
        )?;
        Ok(())
    }

    pub fn create_operator_enrollment(&self) -> Result<Option<String>, ServerError> {
        let mut connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let transaction = connection.transaction()?;
        let device_count: i64 = transaction.query_row("SELECT COUNT(*) FROM devices", [], |row| row.get(0))?;
        if device_count > 0 {
            return Ok(None);
        }
        let existing: Option<String> = transaction
            .query_row(
                "SELECT value FROM metadata WHERE key='operator_enrollment_digest'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if existing.is_some() {
            return Ok(None);
        }
        let token = generate_token();
        transaction.execute(
            "INSERT INTO metadata(key, value) VALUES ('operator_enrollment_digest', ?1)",
            params![digest_token(&token)],
        )?;
        transaction.commit()?;
        Ok(Some(token))
    }

    pub fn enroll_operator(
        &self,
        enrollment_token: &str,
        member_id: &str,
        device_id: &str,
        display_name: &str,
    ) -> Result<DeviceCredential, ServerError> {
        validate_identity(member_id, device_id, display_name)?;
        let mut connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let transaction = connection.transaction()?;
        let expected: Option<String> = transaction
            .query_row(
                "SELECT value FROM metadata WHERE key='operator_enrollment_digest'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if expected.as_deref() != Some(digest_token(enrollment_token).as_str()) {
            return Err(ServerError::Unauthorized);
        }
        let device_count: i64 = transaction.query_row("SELECT COUNT(*) FROM devices", [], |row| row.get(0))?;
        if device_count > 0 {
            return Err(ServerError::InvitationConsumed);
        }
        let credential = insert_device(&transaction, member_id, device_id, display_name, true)?;
        transaction.execute(
            "DELETE FROM metadata WHERE key='operator_enrollment_digest'",
            [],
        )?;
        transaction.commit()?;
        Ok(credential)
    }

    pub fn authenticate(&self, access_token: &str) -> Result<AuthenticatedPrincipal, ServerError> {
        let connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        connection
            .query_row(
                "SELECT member_id, device_id, is_operator FROM devices WHERE token_digest=?1 AND status='active'",
                params![digest_token(access_token)],
                |row| {
                    Ok(AuthenticatedPrincipal {
                        member_id: row.get(0)?,
                        device_id: row.get(1)?,
                        is_operator: row.get::<_, i64>(2)? != 0,
                    })
                },
            )
            .optional()?
            .ok_or(ServerError::Unauthorized)
    }

    pub fn create_meeting(
        &self,
        principal: &AuthenticatedPrincipal,
        meeting_id: &str,
    ) -> Result<(), ServerError> {
        if !principal.is_operator {
            return Err(ServerError::Forbidden);
        }
        if meeting_id.is_empty() || meeting_id.len() > 200 {
            return Err(ServerError::InvalidCommand("meeting id is invalid".into()));
        }
        self.bootstrap_meeting(meeting_id, &principal.member_id, "owner")
    }

    pub fn create_invitation(
        &self,
        principal: &AuthenticatedPrincipal,
        meeting_id: &str,
        role: &str,
        expires_in_seconds: u64,
    ) -> Result<ServerInvitation, ServerError> {
        if !matches!(role, "admin" | "member" | "reviewer") {
            return Err(ServerError::InvalidCommand("invitation role is invalid".into()));
        }
        if !(60..=604_800).contains(&expires_in_seconds) {
            return Err(ServerError::InvalidCommand("invitation expiry is invalid".into()));
        }
        let mut connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let transaction = connection.transaction()?;
        require_member_role(&transaction, meeting_id, &principal.member_id, rbac::can_manage_members)?;
        let invitation_id = Uuid::new_v4().to_string();
        let credential = generate_token();
        let expires_at = unix_timestamp_seconds().saturating_add(expires_in_seconds);
        transaction.execute(
            "INSERT INTO invitations(invitation_id, meeting_id, credential_digest, role, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![invitation_id, meeting_id, digest_token(&credential), role, to_i64(expires_at, "invitation expiry")?],
        )?;
        transaction.commit()?;
        Ok(ServerInvitation {
            invitation_id,
            meeting_id: meeting_id.to_owned(),
            role: role.to_owned(),
            one_time_credential: credential,
            expires_at,
        })
    }

    pub fn consume_invitation(
        &self,
        invitation_id: &str,
        invitation_token: &str,
        member_id: &str,
        device_id: &str,
        display_name: &str,
        key_package: &str,
    ) -> Result<DeviceCredential, ServerError> {
        validate_identity(member_id, device_id, display_name)?;
        validate_base64_blob(key_package, "key package")?;
        let mut connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let transaction = connection.transaction()?;
        let invitation = transaction
            .query_row(
                "SELECT meeting_id, credential_digest, role, expires_at, consumed_at, revoked_at
                 FROM invitations WHERE invitation_id=?1",
                params![invitation_id],
                |row| Ok((
                    row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?, row.get::<_, Option<i64>>(4)?, row.get::<_, Option<i64>>(5)?,
                )),
            )
            .optional()?
            .ok_or(ServerError::NotFound)?;
        let (meeting_id, credential_digest, role, expires_at, consumed_at, revoked_at) = invitation;
        if revoked_at.is_some() {
            return Err(ServerError::InvitationRevoked);
        }
        if consumed_at.is_some() {
            return Err(ServerError::InvitationConsumed);
        }
        if credential_digest != digest_token(invitation_token) {
            return Err(ServerError::Unauthorized);
        }
        if expires_at <= i64::try_from(unix_timestamp_seconds()).unwrap_or(i64::MAX) {
            return Err(ServerError::InvitationExpired);
        }
        let credential = insert_device(&transaction, member_id, device_id, display_name, false)?;
        transaction.execute(
            "INSERT INTO members(meeting_id, member_id, role, status) VALUES (?1, ?2, ?3, 'invited')
             ON CONFLICT(meeting_id, member_id) DO UPDATE SET role=excluded.role, status='invited'",
            params![meeting_id, member_id, role],
        )?;
        transaction.execute(
            "UPDATE invitations SET consumed_at=?2, member_id=?3, device_id=?4, key_package=?5
             WHERE invitation_id=?1 AND consumed_at IS NULL",
            params![
                invitation_id, to_i64(unix_timestamp_seconds(), "consume time")?,
                member_id, device_id, key_package
            ],
        )?;
        transaction.commit()?;
        Ok(credential)
    }

    pub fn pending_join_requests(
        &self,
        principal: &AuthenticatedPrincipal,
        meeting_id: &str,
    ) -> Result<Vec<PendingJoinRequest>, ServerError> {
        let connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        require_member_role(&connection, meeting_id, &principal.member_id, rbac::can_manage_members)?;
        let mut statement = connection.prepare(
            "SELECT i.invitation_id, i.member_id, i.device_id, d.display_name, i.role, i.key_package
             FROM invitations i JOIN devices d ON d.device_id=i.device_id
             WHERE i.meeting_id=?1 AND i.consumed_at IS NOT NULL AND i.admitted_at IS NULL AND i.revoked_at IS NULL
             ORDER BY i.consumed_at ASC"
        )?;
        let rows = statement.query_map(params![meeting_id], |row| {
            Ok(PendingJoinRequest {
                invitation_id: row.get(0)?,
                meeting_id: meeting_id.to_owned(),
                member_id: row.get(1)?,
                device_id: row.get(2)?,
                display_name: row.get(3)?,
                role: row.get(4)?,
                key_package: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(ServerError::from)
    }

    pub fn admit_join_request(
        &self,
        principal: &AuthenticatedPrincipal,
        meeting_id: &str,
        invitation_id: &str,
        welcome: &str,
        ratchet_tree: &str,
        through_sequence: u64,
    ) -> Result<(), ServerError> {
        validate_base64_blob(welcome, "welcome")?;
        validate_base64_blob(ratchet_tree, "ratchet tree")?;
        let mut connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let transaction = connection.transaction()?;
        require_member_role(&transaction, meeting_id, &principal.member_id, rbac::can_manage_members)?;
        let member_id: String = transaction
            .query_row(
                "SELECT member_id FROM invitations
                 WHERE invitation_id=?1 AND meeting_id=?2 AND consumed_at IS NOT NULL
                   AND admitted_at IS NULL AND revoked_at IS NULL",
                params![invitation_id, meeting_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(ServerError::NotFound)?;
        transaction.execute(
            "UPDATE invitations SET welcome=?2, ratchet_tree=?3, admitted_at=?4, admission_sequence=?5 WHERE invitation_id=?1",
            params![
                invitation_id, welcome, ratchet_tree,
                to_i64(unix_timestamp_seconds(), "admission time")?,
                to_i64(through_sequence, "admission sequence")?
            ],
        )?;
        transaction.execute(
            "UPDATE members SET status='active' WHERE meeting_id=?1 AND member_id=?2 AND status='invited'",
            params![meeting_id, member_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn admission_for(
        &self,
        principal: &AuthenticatedPrincipal,
        invitation_id: &str,
    ) -> Result<AdmissionRecord, ServerError> {
        let connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        connection
            .query_row(
                "SELECT meeting_id, welcome, ratchet_tree, admitted_at, admission_sequence
                 FROM invitations WHERE invitation_id=?1 AND member_id=?2 AND device_id=?3",
                params![invitation_id, principal.member_id, principal.device_id],
                |row| {
                    let admitted_at: Option<i64> = row.get(3)?;
                    Ok(AdmissionRecord {
                        status: if admitted_at.is_some() { "ready".into() } else { "pending".into() },
                        meeting_id: row.get(0)?,
                        welcome: row.get(1)?,
                        ratchet_tree: row.get(2)?,
                        through_sequence: u64::try_from(row.get::<_, i64>(4)?).unwrap_or(0),
                    })
                },
            )
            .optional()?
            .ok_or(ServerError::NotFound)
    }

    pub fn revoke_invitation(
        &self,
        principal: &AuthenticatedPrincipal,
        meeting_id: &str,
        invitation_id: &str,
    ) -> Result<(), ServerError> {
        let mut connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let transaction = connection.transaction()?;
        require_member_role(&transaction, meeting_id, &principal.member_id, rbac::can_manage_members)?;
        let changed = transaction.execute(
            "UPDATE invitations SET revoked_at=?3
             WHERE invitation_id=?1 AND meeting_id=?2 AND consumed_at IS NULL AND revoked_at IS NULL",
            params![invitation_id, meeting_id, to_i64(unix_timestamp_seconds(), "revoke time")?],
        )?;
        if changed == 0 {
            return Err(ServerError::NotFound);
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn remove_member(
        &self,
        principal: &AuthenticatedPrincipal,
        meeting_id: &str,
        member_id: &str,
    ) -> Result<(), ServerError> {
        if principal.member_id == member_id {
            return Err(ServerError::Forbidden);
        }
        let mut connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let transaction = connection.transaction()?;
        require_member_role(&transaction, meeting_id, &principal.member_id, rbac::can_manage_members)?;
        let changed = transaction.execute(
            "UPDATE members SET status='removed' WHERE meeting_id=?1 AND member_id=?2 AND status='active'",
            params![meeting_id, member_id],
        )?;
        if changed == 0 {
            return Err(ServerError::NotFound);
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn submit_as(
        &self,
        principal: &AuthenticatedPrincipal,
        command: &CiphertextCommand,
    ) -> Result<SignedReceipt, ServerError> {
        let mut authenticated = command.clone();
        authenticated.member_id = principal.member_id.clone();
        self.submit(&authenticated)
    }

    pub fn events_for_as(
        &self,
        principal: &AuthenticatedPrincipal,
        meeting_id: &str,
        after_sequence: u64,
    ) -> Result<Vec<CiphertextEvent>, ServerError> {
        let connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        require_member_role(&connection, meeting_id, &principal.member_id, rbac::can_submit)?;
        drop(connection);
        self.events_for(meeting_id, after_sequence)
    }

    pub fn submit(&self, command: &CiphertextCommand) -> Result<SignedReceipt, ServerError> {
        validate_command(command)?;
        let mut connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let transaction = connection.transaction()?;
        if let Some(receipt) = transaction
            .query_row(
                "SELECT receipt_json FROM events WHERE meeting_id=?1 AND command_id=?2",
                params![command.meeting_id, command.command_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            return serde_json::from_str(&receipt).map_err(|error| ServerError::Storage(error.to_string()));
        }
        let membership = transaction
            .query_row(
                "SELECT role, status FROM members WHERE meeting_id=?1 AND member_id=?2",
                params![command.meeting_id, command.member_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let (role, status) = membership.ok_or(ServerError::Forbidden)?;
        if !rbac::can_submit(&role, &status) { return Err(ServerError::Forbidden); }
        let current_db: i64 = transaction.query_row(
            "SELECT version FROM meetings WHERE id=?1", params![command.meeting_id], |row| row.get(0)
        )?;
        let current = u64::try_from(current_db).map_err(|_| ServerError::Storage("negative meeting version".into()))?;
        if current != command.expected_version { return Err(ServerError::Conflict(current)); }
        let sequence = current + 1;
        let accepted_at = unix_timestamp_string();
        let signature_input = format!(
            "{}\n{}\n{}\n{}\n{}",
            command.command_id, command.meeting_id, sequence, command.epoch, command.ciphertext_sha256
        );
        let receipt = SignedReceipt {
            command_id: command.command_id.clone(),
            meeting_id: command.meeting_id.clone(),
            sequence,
            accepted_at,
            server_instance_id: self.server_instance_id.clone(),
            signature: base64::engine::general_purpose::STANDARD.encode(self.signing_key.sign(signature_input.as_bytes()).to_bytes()),
        };
        let sequence_db = to_i64(sequence, "sequence")?;
        let epoch_db = to_i64(command.epoch, "epoch")?;
        transaction.execute(
            "INSERT INTO events(meeting_id, sequence, command_id, member_id, epoch, frame_kind, ciphertext, ciphertext_sha256, receipt_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                command.meeting_id, sequence_db, command.command_id, command.member_id, epoch_db,
                command.frame_kind, command.ciphertext, command.ciphertext_sha256,
                serde_json::to_string(&receipt).map_err(|error| ServerError::Storage(error.to_string()))?
            ],
        )?;
        transaction.execute("UPDATE meetings SET version=?2 WHERE id=?1", params![command.meeting_id, sequence_db])?;
        transaction.commit()?;
        Ok(receipt)
    }

    pub fn events_for(&self, meeting_id: &str, after_sequence: u64) -> Result<Vec<CiphertextEvent>, ServerError> {
        let connection = self.connection.lock().map_err(|_| ServerError::Storage("database lock poisoned".into()))?;
        let mut statement = connection.prepare(
            "SELECT receipt_json, member_id, epoch, frame_kind, ciphertext, ciphertext_sha256
             FROM events WHERE meeting_id=?1 AND sequence>?2 ORDER BY sequence ASC LIMIT 1000"
        )?;
        let rows = statement.query_map(params![meeting_id, to_i64(after_sequence, "after sequence")?], |row| {
            let receipt_json: String = row.get(0)?;
            Ok((receipt_json, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
        })?;
        let mut events = Vec::new();
        for row in rows {
            let (receipt_json, member_id, epoch_db, frame_kind, ciphertext, ciphertext_sha256): (String, String, i64, String, String, String) = row?;
            let epoch = u64::try_from(epoch_db).map_err(|_| ServerError::Storage("negative event epoch".into()))?;
            events.push(CiphertextEvent {
                receipt: serde_json::from_str(&receipt_json).map_err(|error| ServerError::Storage(error.to_string()))?,
                member_id, epoch, frame_kind, ciphertext, ciphertext_sha256,
            });
        }
        Ok(events)
    }

    pub fn server_instance_id(&self) -> &str { &self.server_instance_id }

    pub fn receipt_verifying_key(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(self.signing_key.verifying_key().to_bytes())
    }
}

fn validate_identity(member_id: &str, device_id: &str, display_name: &str) -> Result<(), ServerError> {
    if member_id.is_empty() || member_id.len() > 200 || device_id.is_empty() || device_id.len() > 200 {
        return Err(ServerError::InvalidCommand("member or device id is invalid".into()));
    }
    if display_name.trim().is_empty() || display_name.len() > 200 {
        return Err(ServerError::InvalidCommand("display name is invalid".into()));
    }
    Ok(())
}

fn validate_base64_blob(value: &str, field: &str) -> Result<(), ServerError> {
    if value.is_empty() || value.len() > MAX_CIPHERTEXT_CHARS {
        return Err(ServerError::InvalidCommand(format!("{field} is invalid")));
    }
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| ServerError::InvalidCommand(format!("{field} is not base64")))?;
    Ok(())
}

fn insert_device(
    connection: &Connection,
    member_id: &str,
    device_id: &str,
    display_name: &str,
    is_operator: bool,
) -> Result<DeviceCredential, ServerError> {
    let access_token = generate_token();
    connection.execute(
        "INSERT INTO devices(device_id, member_id, display_name, token_digest, status, is_operator, created_at)
         VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)",
        params![
            device_id, member_id, display_name, digest_token(&access_token),
            if is_operator { 1 } else { 0 }, to_i64(unix_timestamp_seconds(), "created time")?
        ],
    ).map_err(|error| match error {
        rusqlite::Error::SqliteFailure(_, Some(message)) if message.contains("UNIQUE") => {
            ServerError::InvalidCommand("device id is already registered".into())
        }
        other => ServerError::from(other),
    })?;
    Ok(DeviceCredential { member_id: member_id.to_owned(), device_id: device_id.to_owned(), access_token })
}

fn require_member_role(
    connection: &Connection,
    meeting_id: &str,
    member_id: &str,
    predicate: fn(&str, &str) -> bool,
) -> Result<(), ServerError> {
    let membership = connection
        .query_row(
            "SELECT role, status FROM members WHERE meeting_id=?1 AND member_id=?2",
            params![meeting_id, member_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let (role, status) = membership.ok_or(ServerError::Forbidden)?;
    if !predicate(&role, &status) {
        return Err(ServerError::Forbidden);
    }
    Ok(())
}

fn generate_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn digest_token(token: &str) -> String {
    auth::token_digest(token).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validate_command(command: &CiphertextCommand) -> Result<(), ServerError> {
    if command.meeting_id.is_empty() || command.command_id.is_empty() || command.member_id.is_empty() {
        return Err(ServerError::InvalidCommand("ids are required".into()));
    }
    if !matches!(command.frame_kind.as_str(), "mls_application" | "mls_commit") {
        return Err(ServerError::InvalidCommand("frame kind is invalid".into()));
    }
    if command.ciphertext.len() > MAX_CIPHERTEXT_CHARS {
        return Err(ServerError::InvalidCommand("ciphertext exceeds the frame limit".into()));
    }
    base64::engine::general_purpose::STANDARD
        .decode(&command.ciphertext)
        .map_err(|_| ServerError::InvalidCommand("ciphertext is not base64".into()))?;
    if command.ciphertext_sha256.len() != 64 || !command.ciphertext_sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ServerError::InvalidCommand("ciphertext hash is invalid".into()));
    }
    Ok(())
}

fn read_or_create_text(connection: &Connection, key: &str, create: impl FnOnce() -> String) -> Result<String, ServerError> {
    if let Some(value) = connection.query_row("SELECT value FROM metadata WHERE key=?1", params![key], |row| row.get(0)).optional()? {
        return Ok(value);
    }
    let value = create();
    connection.execute("INSERT INTO metadata(key, value) VALUES (?1, ?2)", params![key, value])?;
    Ok(value)
}

fn read_or_create_signing_key(connection: &Connection) -> Result<SigningKey, ServerError> {
    if let Some(value) = connection.query_row("SELECT value FROM metadata WHERE key='receipt_signing_key'", [], |row| row.get::<_, String>(0)).optional()? {
        let bytes = base64::engine::general_purpose::STANDARD.decode(value).map_err(|error| ServerError::Storage(error.to_string()))?;
        let seed: [u8; 32] = bytes.try_into().map_err(|_| ServerError::Storage("invalid receipt signing key".into()))?;
        return Ok(SigningKey::from_bytes(&seed));
    }
    let key = SigningKey::generate(&mut OsRng);
    connection.execute(
        "INSERT INTO metadata(key, value) VALUES ('receipt_signing_key', ?1)",
        params![base64::engine::general_purpose::STANDARD.encode(key.to_bytes())],
    )?;
    Ok(key)
}

fn unix_timestamp_string() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn unix_timestamp_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn to_i64(value: u64, field: &str) -> Result<i64, ServerError> {
    i64::try_from(value).map_err(|_| ServerError::InvalidCommand(format!("{field} exceeds SQLite integer range")))
}

fn migrate_schema(connection: &Connection) -> Result<(), ServerError> {
    for (table, column, declaration) in [
        ("invitations", "member_id", "TEXT"),
        ("invitations", "device_id", "TEXT"),
        ("invitations", "key_package", "TEXT"),
        ("invitations", "welcome", "TEXT"),
        ("invitations", "ratchet_tree", "TEXT"),
        ("invitations", "admitted_at", "INTEGER"),
        ("invitations", "admission_sequence", "INTEGER NOT NULL DEFAULT 0"),
        ("events", "frame_kind", "TEXT NOT NULL DEFAULT 'mls_application'"),
    ] {
        ensure_column(connection, table, column, declaration)?;
    }
    Ok(())
}

fn ensure_column(connection: &Connection, table: &str, column: &str, declaration: &str) -> Result<(), ServerError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for current in columns {
        if current? == column {
            return Ok(());
        }
    }
    connection.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {declaration}"))?;
    Ok(())
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS devices(
  device_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, display_name TEXT NOT NULL,
  token_digest TEXT NOT NULL UNIQUE, status TEXT NOT NULL, is_operator INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members(
  meeting_id TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
  PRIMARY KEY(meeting_id, member_id), FOREIGN KEY(meeting_id) REFERENCES meetings(id)
);
CREATE TABLE IF NOT EXISTS invitations(
  invitation_id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, credential_digest TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, revoked_at INTEGER,
  member_id TEXT, device_id TEXT, key_package TEXT, welcome TEXT, ratchet_tree TEXT, admitted_at INTEGER,
  admission_sequence INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(meeting_id) REFERENCES meetings(id)
);
CREATE TABLE IF NOT EXISTS events(
  meeting_id TEXT NOT NULL, sequence INTEGER NOT NULL, command_id TEXT NOT NULL, member_id TEXT NOT NULL,
  epoch INTEGER NOT NULL, frame_kind TEXT NOT NULL DEFAULT 'mls_application',
  ciphertext TEXT NOT NULL, ciphertext_sha256 TEXT NOT NULL, receipt_json TEXT NOT NULL,
  PRIMARY KEY(meeting_id, sequence), UNIQUE(meeting_id, command_id)
);
"#;
