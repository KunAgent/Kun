# Third-Party Notices

## DeepSeek Harness trajectory UI adaptation

Kun's conversation trajectory layout, timing interactions, dense ledger,
inspector behavior, and reference-derived tests are adapted from
`packages/client/ui-trajectory` in DeepSeek Harness, source revision
`0a53fb55bea101816fa226bb964ae2bed71c343b`.

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## CUA Driver

Kun uses `@trycua/cua-driver` version 0.22.2 as the native desktop capture and
input backend for supervised Computer Use. CUA Driver is distributed under the
MIT License. Source: https://github.com/trycua/cua

MIT License

Copyright (c) 2026 Cua AI, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## diagram-design adapted Skill

Kun includes a compact, DESIGN.md-integrated adaptation of the MIT-licensed
`diagram-design` version 2.6 project supplied with this integration. The
selection grammar, connector rules, HTML/SVG output contract, and selected
MIT-licensed icon primitives are adapted for Kun's progressive Skill loading
and existing HTML/canvas/SVG artifact pipeline. The complete license is shipped
at `resources/bundled-skills/diagram-design/LICENSE`.

## KunAgent Skills

Kun includes 34 skills from KunAgent Skills version 1.0.0 (2026), excluding
`diagram-design`, under the MIT License. Copyright (c) 2026 KunAgent. Each
bundled skill retains its license at
`resources/bundled-skills/<skill-id>/LICENSE.txt`.

## agent-skills adapted subagent instructions

Kun includes standalone subagent instructions adapted from the `agents/` and
`skills/` directories of
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills), source
revision `2fbfa004a0192529bc997d103fc12f19a3804aab`.
The original workflow material has been rewritten as self-contained Kun agent
system prompts; it is not loaded as Skill resources at runtime.

MIT License

Copyright (c) 2025 Addy Osmani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## CodexBar provider icons

Kun includes a selected set of provider SVG icons copied from
[steipete/CodexBar](https://github.com/steipete/CodexBar), source revision
`453174fe13eebdf403cc0776268eb2b101fd9553`.

MIT License

Copyright (c) 2026 Peter Steinberger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## ONNX Runtime Node binding

Kun uses `onnxruntime-node` version 1.23.2 together with `onnxruntime-common`
version 1.23.2 to run the local Kokoro speech model for the Speak action. Both
packages are distributed under the MIT License by Microsoft. Only the prebuilt
binary matching the packaged platform and architecture is shipped; the others
are removed during packaging.

MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## phonemizer.js and the espeak-ng build it embeds

Kun uses `phonemizer` version 1.2.1 to turn text into the IPA phonemes the
Kokoro speech model consumes. The package is published under the Apache License
2.0 by its author, and its bundle embeds a WebAssembly build of espeak-ng
together with the `espeak-ng-data` dictionaries.

espeak-ng (https://github.com/espeak-ng/espeak-ng) is licensed under the GNU
General Public License, version 3 or later. The `phonemizer` package metadata
declares Apache-2.0 for the wrapper and carries no separate notice for the
embedded espeak-ng artifacts; those artifacts remain covered by espeak-ng's own
terms.

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
GNU General Public License v3.0: https://www.gnu.org/licenses/gpl-3.0.html

## Kokoro-82M speech model weights

The Speak action downloads its weights at run time from the
`onnx-community/Kokoro-82M-v1.0-ONNX` repository on Hugging Face; no model file
ships inside Kun. The model card publishes the weights and the voice style
vectors under the Apache License 2.0, which is the license recorded for each
model tier in Kun's own catalog and shown in Settings before a download starts.

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
