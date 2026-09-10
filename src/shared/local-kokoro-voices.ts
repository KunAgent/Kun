/**
 * Kokoro voice catalog.
 *
 * Only the English voices ship: the bundled espeak-ng phonemizer build carries
 * English data alone, so the Japanese/Chinese/Spanish/French/Hindi/Italian/
 * Portuguese voices in the upstream repository cannot be pronounced correctly
 * and are deliberately excluded.
 */
export const LOCAL_KOKORO_VOICES = [
  {
    id: 'af_alloy',
    label: 'Alloy',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: 'c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45'
  },
  {
    id: 'af_aoede',
    label: 'Aoede',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361'
  },
  {
    id: 'af_bella',
    label: 'Bella',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'
  },
  {
    id: 'af_heart',
    label: 'Heart',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'
  },
  {
    id: 'af_jessica',
    label: 'Jessica',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: 'a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8'
  },
  {
    id: 'af_kore',
    label: 'Kore',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e'
  },
  {
    id: 'af_nicole',
    label: 'Nicole',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a'
  },
  {
    id: 'af_nova',
    label: 'Nova',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f'
  },
  {
    id: 'af_river',
    label: 'River',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30'
  },
  {
    id: 'af_sarah',
    label: 'Sarah',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a'
  },
  {
    id: 'af_sky',
    label: 'Sky',
    accent: 'en-us',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9'
  },
  {
    id: 'am_adam',
    label: 'Adam',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: '162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716'
  },
  {
    id: 'am_echo',
    label: 'Echo',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: '3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3'
  },
  {
    id: 'am_eric',
    label: 'Eric',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: 'e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832'
  },
  {
    id: 'am_fenrir',
    label: 'Fenrir',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43'
  },
  {
    id: 'am_liam',
    label: 'Liam',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: '52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade'
  },
  {
    id: 'am_michael',
    label: 'Michael',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'
  },
  {
    id: 'am_onyx',
    label: 'Onyx',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: 'da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6'
  },
  {
    id: 'am_puck',
    label: 'Puck',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0'
  },
  {
    id: 'am_santa',
    label: 'Santa',
    accent: 'en-us',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: '61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a'
  },
  {
    id: 'bf_alice',
    label: 'Alice',
    accent: 'en-gb',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573'
  },
  {
    id: 'bf_emma',
    label: 'Emma',
    accent: 'en-gb',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'
  },
  {
    id: 'bf_isabella',
    label: 'Isabella',
    accent: 'en-gb',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f'
  },
  {
    id: 'bf_lily',
    label: 'Lily',
    accent: 'en-gb',
    gender: 'female',
    sizeBytes: 522_240,
    sha256: '5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335'
  },
  {
    id: 'bm_daniel',
    label: 'Daniel',
    accent: 'en-gb',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: '6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8'
  },
  {
    id: 'bm_fable',
    label: 'Fable',
    accent: 'en-gb',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: 'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1'
  },
  {
    id: 'bm_george',
    label: 'George',
    accent: 'en-gb',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc'
  },
  {
    id: 'bm_lewis',
    label: 'Lewis',
    accent: 'en-gb',
    gender: 'male',
    sizeBytes: 522_240,
    sha256: 'b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97'
  }
] as const

export type LocalKokoroVoiceId = (typeof LOCAL_KOKORO_VOICES)[number]['id']
export type LocalKokoroVoiceAccent = (typeof LOCAL_KOKORO_VOICES)[number]['accent']
export type LocalKokoroVoiceGender = (typeof LOCAL_KOKORO_VOICES)[number]['gender']
export type LocalKokoroVoice = (typeof LOCAL_KOKORO_VOICES)[number]

export const LOCAL_KOKORO_VOICE_ACCENTS = ['en-us', 'en-gb'] as const

export const LOCAL_KOKORO_DEFAULT_VOICE_ID: LocalKokoroVoiceId = 'af_heart'

export function isLocalKokoroVoiceId(value: unknown): value is LocalKokoroVoiceId {
  return LOCAL_KOKORO_VOICES.some((voice) => voice.id === value)
}

export function localKokoroVoiceById(voiceId: unknown): LocalKokoroVoice {
  return (
    LOCAL_KOKORO_VOICES.find((voice) => voice.id === voiceId)
    ?? LOCAL_KOKORO_VOICES.find((voice) => voice.id === LOCAL_KOKORO_DEFAULT_VOICE_ID)
    ?? LOCAL_KOKORO_VOICES[0]
  )
}

/** espeak-ng language identifier used to phonemize text for a voice. */
export function localKokoroVoiceLanguage(voiceId: unknown): LocalKokoroVoiceAccent {
  return localKokoroVoiceById(voiceId).accent
}
