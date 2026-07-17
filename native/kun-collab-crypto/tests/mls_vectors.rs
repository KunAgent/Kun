use kun_collab_crypto::MlsClient;

const STATE_KEY: [u8; 32] = [7; 32];

#[test]
fn add_join_encrypt_and_restore_use_real_openmls_state() {
    let mut alice = MlsClient::new(b"alice").expect("alice identity");
    let mut bob = MlsClient::new(b"bob").expect("bob identity");
    let bob_key_package = bob.key_package().expect("bob key package");

    alice.create_group(b"meeting-1").expect("create group");
    let added = alice.add_member(&bob_key_package).expect("add bob");
    bob.join_group(&added.welcome, &added.ratchet_tree).expect("join group");

    let ciphertext = alice.encrypt(b"release review").expect("encrypt");
    assert_eq!(bob.decrypt(&ciphertext).expect("decrypt"), b"release review");
    assert_eq!(alice.epoch(), Some(1));
    assert_eq!(bob.epoch(), Some(1));

    let encrypted_state = bob.export_encrypted_state(&STATE_KEY).expect("export state");
    assert!(!encrypted_state.windows(b"release review".len()).any(|window| window == b"release review"));
    let mut restored = MlsClient::import_encrypted_state(&encrypted_state, &STATE_KEY).expect("restore state");
    let second = alice.encrypt(b"after restart").expect("encrypt after restart");
    assert_eq!(restored.decrypt(&second).expect("restored decrypt"), b"after restart");
}

#[test]
fn tampered_state_and_removed_member_are_rejected() {
    let mut alice = MlsClient::new(b"alice").expect("alice identity");
    let mut bob = MlsClient::new(b"bob").expect("bob identity");
    let bob_key_package = bob.key_package().expect("bob key package");
    alice.create_group(b"meeting-2").expect("create group");
    let added = alice.add_member(&bob_key_package).expect("add bob");
    bob.join_group(&added.welcome, &added.ratchet_tree).expect("join group");

    let mut state = bob.export_encrypted_state(&STATE_KEY).expect("export state");
    let last = state.len() - 1;
    state[last] ^= 0x01;
    assert!(MlsClient::import_encrypted_state(&state, &STATE_KEY).is_err());

    alice.remove_member(b"bob").expect("remove bob");
    let post_remove = alice.encrypt(b"new epoch secret").expect("encrypt post-remove");
    assert!(bob.decrypt(&post_remove).is_err());
    assert_eq!(alice.epoch(), Some(2));
}

#[test]
fn three_clients_catch_up_and_removed_member_cannot_read_later_epoch() {
    let mut alice = MlsClient::new(b"alice").expect("alice");
    let mut bob = MlsClient::new(b"bob").expect("bob");
    let mut charlie = MlsClient::new(b"charlie").expect("charlie");
    alice.create_group(b"meeting-3").expect("create group");

    let bob_added = alice.add_member(&bob.key_package().expect("bob key package")).expect("add bob");
    bob.join_group(&bob_added.welcome, &bob_added.ratchet_tree).expect("bob joins");

    let charlie_added = alice.add_member(&charlie.key_package().expect("charlie key package")).expect("add charlie");
    bob.process_commit(&charlie_added.commit).expect("bob catches up");
    charlie.join_group(&charlie_added.welcome, &charlie_added.ratchet_tree).expect("charlie joins");

    let shared = alice.encrypt(b"all members").expect("encrypt shared");
    assert_eq!(bob.decrypt(&shared).expect("bob decrypt"), b"all members");
    assert_eq!(charlie.decrypt(&shared).expect("charlie decrypt"), b"all members");

    let remove_bob = alice.remove_member(b"bob").expect("remove bob");
    charlie.process_commit(&remove_bob).expect("charlie catches up removal");
    let later = alice.encrypt(b"after bob removed").expect("encrypt later");
    assert_eq!(charlie.decrypt(&later).expect("charlie decrypt later"), b"after bob removed");
    assert!(bob.decrypt(&later).is_err());

    let mut tampered = later;
    *tampered.last_mut().expect("ciphertext byte") ^= 1;
    assert!(charlie.decrypt(&tampered).is_err());
}
