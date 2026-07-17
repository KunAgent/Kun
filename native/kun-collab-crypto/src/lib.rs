mod group;

pub use group::{AddMemberResult, MlsClient, MlsClientError};
use napi::bindgen_prelude::Buffer;
use std::sync::Mutex;

#[napi_derive::napi(object)]
pub struct NativeAddMemberResult {
    pub commit: Buffer,
    pub welcome: Buffer,
    pub ratchet_tree: Buffer,
}

#[napi_derive::napi]
pub struct NativeMlsClient {
    inner: Mutex<MlsClient>,
}

#[napi_derive::napi]
impl NativeMlsClient {
    #[napi(constructor)]
    pub fn new(identity: Buffer) -> napi::Result<Self> {
        Ok(Self {
            inner: Mutex::new(MlsClient::new(&identity).map_err(napi_error)?),
        })
    }

    #[napi(factory)]
    pub fn import_encrypted_state(state: Buffer, state_key: Buffer) -> napi::Result<Self> {
        let key = state_key_32(&state_key)?;
        Ok(Self {
            inner: Mutex::new(MlsClient::import_encrypted_state(&state, &key).map_err(napi_error)?),
        })
    }

    #[napi]
    pub fn key_package(&self) -> napi::Result<Buffer> {
        Ok(self.lock()?.key_package().map_err(napi_error)?.into())
    }

    #[napi]
    pub fn create_group(&self, group_id: Buffer) -> napi::Result<()> {
        self.lock()?.create_group(&group_id).map_err(napi_error)
    }

    #[napi]
    pub fn add_member(&self, key_package: Buffer) -> napi::Result<NativeAddMemberResult> {
        let result = self.lock()?.add_member(&key_package).map_err(napi_error)?;
        Ok(NativeAddMemberResult {
            commit: result.commit.into(),
            welcome: result.welcome.into(),
            ratchet_tree: result.ratchet_tree.into(),
        })
    }

    #[napi]
    pub fn join_group(&self, welcome: Buffer, ratchet_tree: Buffer) -> napi::Result<()> {
        self.lock()?.join_group(&welcome, &ratchet_tree).map_err(napi_error)
    }

    #[napi]
    pub fn encrypt(&self, plaintext: Buffer) -> napi::Result<Buffer> {
        Ok(self.lock()?.encrypt(&plaintext).map_err(napi_error)?.into())
    }

    #[napi]
    pub fn decrypt(&self, ciphertext: Buffer) -> napi::Result<Buffer> {
        Ok(self.lock()?.decrypt(&ciphertext).map_err(napi_error)?.into())
    }

    #[napi]
    pub fn process_commit(&self, commit: Buffer) -> napi::Result<()> {
        self.lock()?.process_commit(&commit).map_err(napi_error)
    }

    #[napi]
    pub fn remove_member(&self, identity: Buffer) -> napi::Result<Buffer> {
        Ok(self.lock()?.remove_member(&identity).map_err(napi_error)?.into())
    }

    #[napi(getter)]
    pub fn epoch(&self) -> napi::Result<Option<i64>> {
        Ok(self.lock()?.epoch().map(|epoch| epoch as i64))
    }

    #[napi]
    pub fn checkpoint_digest(&self) -> napi::Result<Buffer> {
        Ok(self.lock()?.checkpoint_digest().map_err(napi_error)?.into())
    }

    #[napi]
    pub fn export_encrypted_state(&self, state_key: Buffer) -> napi::Result<Buffer> {
        let key = state_key_32(&state_key)?;
        Ok(self.lock()?.export_encrypted_state(&key).map_err(napi_error)?.into())
    }

    fn lock(&self) -> napi::Result<std::sync::MutexGuard<'_, MlsClient>> {
        self.inner.lock().map_err(|_| napi::Error::from_reason("OpenMLS client lock poisoned"))
    }
}

#[napi_derive::napi]
pub fn openmls_binding_version() -> String {
    "openmls-0.8.1/rfc9420".to_string()
}

fn state_key_32(input: &[u8]) -> napi::Result<[u8; 32]> {
    input
        .try_into()
        .map_err(|_| napi::Error::from_reason("state key must be exactly 32 bytes"))
}

fn napi_error(error: MlsClientError) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}
