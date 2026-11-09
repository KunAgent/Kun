// Public signing root and origin are pinned in the signed host, independent of downloaded code.
export const CONTROL_HOST_BUILD_GENERATION = 2
export const UPDATE_TRUST = {
  "origin": "https://api-kun-server.com",
  "root": {
    "signatures": [
      {
        "keyid": "23a58baf655302a132c785e015dcdf23a82d34a7173984bba10ddcf25e83528a",
        "sig": "40733b829c51cc333dd7091d148e6df79517abf41fd8f44dc8635feb5f0a3e278bc86aa2a92250e8a61bdb184ab35d634baf89c37d72cbb23c6578afbea7ca04"
      },
      {
        "keyid": "5b54da7529e6f8f3446d120f85b67c2a471fc35a18ba64ba243a1cd579578c3d",
        "sig": "9a6f59e60ca28bf5bfb159bc7022200c8dfe38909fd40457fd1414ee1eaac5ccf0432767381bb4ca06923ab0d4bbfb4f47234a1278bcb4756262e97db6751f0d"
      }
    ],
    "signed": {
      "_type": "root",
      "spec_version": "1.0.31",
      "version": 1,
      "expires": "2027-11-06T09:43:09.946Z",
      "keys": {
        "23a58baf655302a132c785e015dcdf23a82d34a7173984bba10ddcf25e83528a": {
          "keytype": "ed25519",
          "scheme": "ed25519",
          "keyval": {
            "public": "73b090cf9be4dee6daf267b7f19549ef06b2d3f70a74a7c797b55d841393329a"
          }
        },
        "5b54da7529e6f8f3446d120f85b67c2a471fc35a18ba64ba243a1cd579578c3d": {
          "keytype": "ed25519",
          "scheme": "ed25519",
          "keyval": {
            "public": "5b41c59f8eab8ea549668fe7585043bc4f5650cf36e0fe0bd49506c0ae8aff76"
          }
        },
        "5c03685acc41fd808b24062d35ea003a1f417635400d7c0f8baf2b04ad33c6a1": {
          "keytype": "ed25519",
          "scheme": "ed25519",
          "keyval": {
            "public": "a0ae22bc9d84204dcf13a81ba5583d396c9dbd3d50b8c46c81d8e0d4d3c2e5f5"
          }
        },
        "677ba74b05a3d0c707bf40ce9a4d96673908029171fb159556f3d1641f4204af": {
          "keytype": "ed25519",
          "scheme": "ed25519",
          "keyval": {
            "public": "43514a9502dffcb7590c9484e534ccf9961fb714a408f601bc91b36bc75d099c"
          }
        },
        "8defb202a7bacc25fe35a1b278673090c5bc657beef61eed9509e2e3e74aedfd": {
          "keytype": "ed25519",
          "scheme": "ed25519",
          "keyval": {
            "public": "cddd31923575b302b273bdc6687ba6e26a6f3fb64bf0001f47e21081ff8d627e"
          }
        },
        "bdcb55e146cd6fc801b099d43fd78d36abaac0e41c143acef3022cd7a43979f5": {
          "keytype": "ed25519",
          "scheme": "ed25519",
          "keyval": {
            "public": "c68fc4a7d8f6e33f7c7335c6f9d55de0d6700d4d6892b241c9e1c1d99ad6dbd6"
          }
        }
      },
      "roles": {
        "root": {
          "keyids": [
            "23a58baf655302a132c785e015dcdf23a82d34a7173984bba10ddcf25e83528a",
            "5b54da7529e6f8f3446d120f85b67c2a471fc35a18ba64ba243a1cd579578c3d",
            "5c03685acc41fd808b24062d35ea003a1f417635400d7c0f8baf2b04ad33c6a1"
          ],
          "threshold": 2
        },
        "targets": {
          "keyids": [
            "677ba74b05a3d0c707bf40ce9a4d96673908029171fb159556f3d1641f4204af"
          ],
          "threshold": 1
        },
        "snapshot": {
          "keyids": [
            "8defb202a7bacc25fe35a1b278673090c5bc657beef61eed9509e2e3e74aedfd"
          ],
          "threshold": 1
        },
        "timestamp": {
          "keyids": [
            "bdcb55e146cd6fc801b099d43fd78d36abaac0e41c143acef3022cd7a43979f5"
          ],
          "threshold": 1
        }
      },
      "consistent_snapshot": true
    }
  }
} as const
