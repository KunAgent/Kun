## 1. Tab state and layout foundation

- [x] 1.1 Add built-in contribution IDs and a pure versioned Code right-tab state model with open, activate, close, collapse, normalization, and legacy migration behavior
- [x] 1.2 Integrate per-workspace tab persistence and derived active `rightPanelMode` into the workbench layout while retaining the vertical-rail width reservation

## 2. Tab navigation chrome

- [x] 2.1 Build the accessible horizontal tab strip, dynamic labels, close behavior, overflow handling, and collapse control
- [x] 2.2 Wire Code-mode rail/top actions and route Dev Preview, review, canvas, subagent, file-preview, and extension launch paths through the tab controller while keeping Terminal on its independent drawer controller

## 3. Tool integration and lifecycle

- [x] 3.1 Preserve Terminal as the resizable bottom drawer with its internal PTY tabs and shortcut behavior, independent of right-workspace tab selection
- [x] 3.2 Move Files and File preview into distinct tabs while preserving workspace/design trees, file references, preview tabs, pins, and thread-retention rules
- [x] 3.3 Add a docked Side conversations tab with count/running state and keep Subagents as its existing independent detail tab
- [x] 3.4 Keep trusted extension tabs mounted across selection, preserve locked permission review, and dispose tabs on close, revocation, or workspace invalidation

## 4. Compatibility, copy, and specifications

- [x] 4.1 Add English and Simplified Chinese tab labels and update extension/video-editor guidance for direct rail tabs
- [x] 4.2 Preserve Write, Design, and SDD panel behavior, retain the Code launcher rail and terminal drawer, and remove only the obsolete file-column state without changing public IPC/runtime contracts

## 5. Verification

- [x] 5.1 Add focused state, accessibility, tool-routing, layout, side-conversation, terminal, file, and extension lifecycle tests
- [x] 5.2 Run focused Vitest, typecheck, full tests, build, strict OpenSpec validation, visual smoke checks, and diff hygiene checks

## 6. Navigation correction

- [x] 6.1 Restore the existing Code vertical icon rail and route its built-in and extension launchers through the singleton tab controller
- [x] 6.2 Support an expanded empty right workspace instead of automatically opening Files or Browser
- [x] 6.3 Make the horizontal tab chrome an Electron no-drag region so tab and collapse controls receive pointer input
- [x] 6.4 Add correction-focused state, layout, rail, and tab-chrome tests; rerun validation and update navigation guidance

## 7. Terminal placement correction

- [x] 7.1 Restore the Code top-bar Terminal action and the original resizable bottom terminal drawer
- [x] 7.2 Route the top action and `Ctrl+\`` to the same drawer while excluding Terminal from right-tab persistence and migration
- [x] 7.3 Add terminal-routing and invalid-tab regression tests, update specifications, and rerun focused validation

## 8. Redundant tool-menu correction

- [x] 8.1 Remove the duplicate `+` tool menu from the horizontal tab strip while retaining tab navigation, close, overflow, and collapse controls
- [x] 8.2 Remove menu-only routing props and locale copy, keeping built-in and extension discovery on the vertical rail and Terminal on its top-bar action/shortcut
- [x] 8.3 Update OpenSpec and extension guidance, add regression coverage, and rerun focused and full validation
