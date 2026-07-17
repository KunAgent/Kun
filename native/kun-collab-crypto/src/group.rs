use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_memory_storage::MemoryStorage;
use openmls_rust_crypto::RustCrypto;
use openmls_traits::OpenMlsProvider;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tls_codec::{Deserialize as TlsDeserialize, Serialize as TlsSerialize};

const CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const STATE_AAD: &[u8] = b"kun-collab-openmls-state-v1";

#[derive(Debug, thiserror::Error)]
pub enum MlsClientError {
    #[error("OpenMLS operation failed: {0}")]
    OpenMls(String),
    #[error("invalid MLS state: {0}")]
    InvalidState(String),
    #[error("MLS group is not initialized")]
    GroupMissing,
    #[error("MLS member was not found")]
    MemberMissing,
    #[error("encrypted MLS state authentication failed")]
    StateAuthentication,
}

pub type Result<T> = std::result::Result<T, MlsClientError>;

#[derive(Default, Debug)]
struct Provider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl OpenMlsProvider for Provider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }

    fn crypto(&self) -> &Self::CryptoProvider {
        &self.crypto
    }

    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
    }
}

#[derive(Debug)]
pub struct AddMemberResult {
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
    pub ratchet_tree: Vec<u8>,
}

pub struct MlsClient {
    provider: Provider,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    identity: Vec<u8>,
    group: Option<MlsGroup>,
}

#[derive(Serialize, Deserialize)]
struct PersistedClient {
    storage: Vec<u8>,
    signer: SignatureKeyPair,
    identity: Vec<u8>,
    group_id: Option<Vec<u8>>,
}

impl MlsClient {
    pub fn new(identity: &[u8]) -> Result<Self> {
        if identity.is_empty() {
            return Err(MlsClientError::InvalidState("identity is empty".into()));
        }
        let provider = Provider::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
            .map_err(debug_error)?;
        signer.store(provider.storage()).map_err(debug_error)?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        Ok(Self {
            provider,
            signer,
            credential,
            identity: identity.to_vec(),
            group: None,
        })
    }

    pub fn key_package(&mut self) -> Result<Vec<u8>> {
        let bundle = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(debug_error)?;
        bundle
            .key_package()
            .tls_serialize_detached()
            .map_err(debug_error)
    }

    pub fn create_group(&mut self, group_id: &[u8]) -> Result<()> {
        if group_id.is_empty() {
            return Err(MlsClientError::InvalidState("group id is empty".into()));
        }
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .build();
        let group = MlsGroup::new_with_group_id(
            &self.provider,
            &self.signer,
            &config,
            GroupId::from_slice(group_id),
            self.credential.clone(),
        )
        .map_err(debug_error)?;
        self.group = Some(group);
        Ok(())
    }

    pub fn add_member(&mut self, key_package_bytes: &[u8]) -> Result<AddMemberResult> {
        let key_package = KeyPackageIn::tls_deserialize_exact(key_package_bytes)
            .map_err(debug_error)?
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(debug_error)?;
        let group = self.group.as_mut().ok_or(MlsClientError::GroupMissing)?;
        let (commit, welcome, _) = group
            .add_members(&self.provider, &self.signer, &[key_package])
            .map_err(debug_error)?;
        let ratchet_tree = group
            .export_ratchet_tree()
            .tls_serialize_detached()
            .map_err(debug_error)?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(debug_error)?;
        Ok(AddMemberResult {
            commit: commit.tls_serialize_detached().map_err(debug_error)?,
            welcome: welcome.tls_serialize_detached().map_err(debug_error)?,
            ratchet_tree,
        })
    }

    pub fn join_group(&mut self, welcome_bytes: &[u8], ratchet_tree_bytes: &[u8]) -> Result<()> {
        let welcome = match MlsMessageIn::tls_deserialize_exact(welcome_bytes)
            .map_err(debug_error)?
            .extract()
        {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err(MlsClientError::InvalidState("message is not an MLS Welcome".into())),
        };
        let ratchet_tree = RatchetTreeIn::tls_deserialize_exact(ratchet_tree_bytes)
            .map_err(debug_error)?;
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .build();
        let group = StagedWelcome::new_from_welcome(
            &self.provider,
            config.join_config(),
            welcome,
            Some(ratchet_tree),
        )
        .map_err(debug_error)?
        .into_group(&self.provider)
        .map_err(debug_error)?;
        self.group = Some(group);
        Ok(())
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let group = self.group.as_mut().ok_or(MlsClientError::GroupMissing)?;
        group
            .create_message(&self.provider, &self.signer, plaintext)
            .map_err(debug_error)?
            .tls_serialize_detached()
            .map_err(debug_error)
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        let message = MlsMessageIn::tls_deserialize_exact(ciphertext)
            .map_err(debug_error)?
            .try_into_protocol_message()
            .map_err(debug_error)?;
        let group = self.group.as_mut().ok_or(MlsClientError::GroupMissing)?;
        let processed = group
            .process_message(&self.provider, message)
            .map_err(debug_error)?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => Ok(message.into_bytes()),
            _ => Err(MlsClientError::InvalidState("message is not MLS application data".into())),
        }
    }

    pub fn process_commit(&mut self, commit: &[u8]) -> Result<()> {
        let message = MlsMessageIn::tls_deserialize_exact(commit)
            .map_err(debug_error)?
            .try_into_protocol_message()
            .map_err(debug_error)?;
        let group = self.group.as_mut().ok_or(MlsClientError::GroupMissing)?;
        let processed = group
            .process_message(&self.provider, message)
            .map_err(debug_error)?;
        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged) => group
                .merge_staged_commit(&self.provider, *staged)
                .map_err(debug_error),
            _ => Err(MlsClientError::InvalidState("message is not an MLS commit".into())),
        }
    }

    pub fn remove_member(&mut self, identity: &[u8]) -> Result<Vec<u8>> {
        let group = self.group.as_mut().ok_or(MlsClientError::GroupMissing)?;
        let index = group
            .members()
            .find(|member| member.credential.serialized_content() == identity)
            .map(|member| member.index)
            .ok_or(MlsClientError::MemberMissing)?;
        let (commit, _, _) = group
            .remove_members(&self.provider, &self.signer, &[index])
            .map_err(debug_error)?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(debug_error)?;
        commit.tls_serialize_detached().map_err(debug_error)
    }

    pub fn epoch(&self) -> Option<u64> {
        self.group.as_ref().map(|group| group.epoch().as_u64())
    }

    pub fn checkpoint_digest(&self) -> Result<Vec<u8>> {
        let group = self.group.as_ref().ok_or(MlsClientError::GroupMissing)?;
        let mut digest = Sha256::new();
        digest.update(group.group_id().as_slice());
        digest.update(group.epoch().as_u64().to_be_bytes());
        for member in group.members() {
            digest.update(member.index.u32().to_be_bytes());
            digest.update(member.credential.serialized_content());
            digest.update(member.signature_key);
        }
        Ok(digest.finalize().to_vec())
    }

    pub fn export_encrypted_state(&self, state_key: &[u8; 32]) -> Result<Vec<u8>> {
        let mut storage = Vec::new();
        self.provider
            .storage
            .serialize(&mut storage)
            .map_err(debug_error)?;
        let persisted = PersistedClient {
            storage,
            signer: serde_json::from_slice(
                &serde_json::to_vec(&self.signer).map_err(debug_error)?,
            )
            .map_err(debug_error)?,
            identity: self.identity.clone(),
            group_id: self.group.as_ref().map(|group| group.group_id().as_slice().to_vec()),
        };
        let plaintext = serde_json::to_vec(&persisted).map_err(debug_error)?;
        let nonce_bytes: [u8; 12] = rand::random();
        let cipher = Aes256Gcm::new_from_slice(state_key).map_err(debug_error)?;
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload { msg: &plaintext, aad: STATE_AAD },
            )
            .map_err(|_| MlsClientError::StateAuthentication)?;
        let mut output = nonce_bytes.to_vec();
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    pub fn import_encrypted_state(blob: &[u8], state_key: &[u8; 32]) -> Result<Self> {
        if blob.len() <= 12 {
            return Err(MlsClientError::InvalidState("encrypted state is truncated".into()));
        }
        let (nonce, ciphertext) = blob.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(state_key).map_err(debug_error)?;
        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload { msg: ciphertext, aad: STATE_AAD },
            )
            .map_err(|_| MlsClientError::StateAuthentication)?;
        let persisted: PersistedClient = serde_json::from_slice(&plaintext).map_err(debug_error)?;
        let storage = MemoryStorage::deserialize(&mut persisted.storage.as_slice())
            .map_err(debug_error)?;
        let provider = Provider { crypto: RustCrypto::default(), storage };
        let credential = CredentialWithKey {
            credential: BasicCredential::new(persisted.identity.clone()).into(),
            signature_key: persisted.signer.to_public_vec().into(),
        };
        let group = match persisted.group_id {
            Some(group_id) => Some(
                MlsGroup::load(provider.storage(), &GroupId::from_slice(&group_id))
                    .map_err(debug_error)?
                    .ok_or_else(|| MlsClientError::InvalidState("persisted group is missing".into()))?,
            ),
            None => None,
        };
        Ok(Self {
            provider,
            signer: persisted.signer,
            credential,
            identity: persisted.identity,
            group,
        })
    }
}

fn debug_error(error: impl std::fmt::Debug) -> MlsClientError {
    MlsClientError::OpenMls(format!("{error:?}"))
}
