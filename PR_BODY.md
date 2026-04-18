## Semantic Verification Proof for `history/001.json`

**Lossless Property Check (No Silent Omissions)**
- [x] All JSON properties visually accounted for
- [x] All state names, hierarchies, and pseudo-property nodes natively mapped (`shallow` history mapped correctly to `[H]`)

**States & Topology**
- [x] `initial` state correctly mapped to `on` and nested `initial` correctly mapped to `first`
- [x] State `on` exists
- [x] State `off` exists
- [x] State `first` exists
- [x] State `second` exists
- [x] History pseudo-state `hist` is accurately represented using Mermaid `[H]` syntax

**Transitions**
- [x] Event `SWITCH` correctly transitions `first` -> `second`
- [x] Event `POWER` correctly transitions `on` -> `off`
- [x] Event `POWER` correctly transitions `off` -> `on_hist`

**Validation Result**: PASS
